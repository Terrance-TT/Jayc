import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

/*
 * Auto-resume: when the model's stream dies mid-response (token caps, CPU limits, network
 * drops), the client automatically asks the model to continue. The synthetic user message
 * below is an implementation detail of that mechanism.
 */
const CONTINUE_PROMPT =
  'Continue your prior response. IMPORTANT: Immediately begin from where you left off without any interruptions. Do not repeat any content, including artifact and action tags.';

const MAX_RESUME_ATTEMPTS = 8;
const RESUME_DELAY_MS = 1500;

/*
 * Continuation turns arrive as separate messages (synthetic user prompt + new assistant
 * reply). Stitching them back into one logical message lets the artifact parser resume
 * exactly where the previous stream stopped - even in the middle of a file - instead of
 * treating the continuation as standalone chat text.
 */
function mergeContinuationMessages(messages: Message[]): Message[] {
  const merged: Message[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];

    if (message.role === 'user' && message.content === CONTINUE_PROMPT && previous?.role === 'assistant') {
      continue;
    }

    if (message.role === 'assistant' && previous?.role === 'assistant') {
      merged[merged.length - 1] = { ...previous, content: previous.content + message.content };
      continue;
    }

    merged.push(message);
  }

  return merged;
}

/*
 * A response that stopped mid-artifact (or mid-file) has unbalanced bolt tags.
 * A response that completed cleanly is always balanced.
 */
function hasUnclosedTags(content: string): boolean {
  const artifactOpens = (content.match(/<boltArtifact\b/g) || []).length;
  const artifactCloses = (content.match(/<\/boltArtifact>/g) || []).length;
  const actionOpens = (content.match(/<boltAction\b/g) || []).length;
  const actionCloses = (content.match(/<\/boltAction>/g) || []).length;

  return artifactOpens > artifactCloses || actionOpens > actionCloses;
}

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  /*
   * Auto-resume bookkeeping (refs so the stream callbacks always see the latest values):
   * - resumeAttempts: how many times we've auto-continued the current response
   * - manualStopRef: true when the user pressed Stop - never resume after that
   * - resumeTimeoutRef: pending delayed resume, so Stop/unmount can cancel it
   * - messagesRef: latest messages array, avoiding stale closures in callbacks
   */
  const resumeAttempts = useRef(0);
  const manualStopRef = useRef(false);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<Message[]>([]);

  const { messages, isLoading, input, handleInputChange, setInput, stop, reload, append } = useChat({
    api: '/api/chat',
    onError: (error) => {
      logger.error('Request failed\n\n', error);

      if (manualStopRef.current) {
        return;
      }

      const resumeMode = getResumeMode();

      if (resumeMode) {
        logger.debug(`Stream interrupted, auto-resuming (${resumeMode})`);
        scheduleResume(resumeMode);
        return;
      }

      toast.error('There was an error processing your request');
    },
    onFinish: () => {
      logger.debug('Finished streaming');

      if (manualStopRef.current) {
        return;
      }

      const resumeMode = getResumeMode();

      if (resumeMode) {
        logger.debug(`Response truncated, auto-resuming (${resumeMode})`);
        scheduleResume(resumeMode);
      } else {
        resumeAttempts.current = 0;
      }
    },
    initialMessages,
  });

  messagesRef.current = messages;

  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, []);

  /*
   * Decide whether the last exchange was cut off, and how to resume it:
   * - 'reload': the assistant reply never materialized (or is empty) - drop the stub and retry.
   * - 'append': the reply stopped mid-artifact - ask the model to continue exactly in place.
   * - null: the response looks complete - do nothing.
   */
  const getResumeMode = (): 'append' | 'reload' | null => {
    const currentMessages = messagesRef.current;
    const lastMessage = currentMessages[currentMessages.length - 1];

    if (!lastMessage) {
      return null;
    }

    if (lastMessage.role === 'user' || !lastMessage.content) {
      return 'reload';
    }

    if (hasUnclosedTags(lastMessage.content)) {
      return 'append';
    }

    return null;
  };

  const scheduleResume = (mode: 'append' | 'reload') => {
    if (resumeAttempts.current >= MAX_RESUME_ATTEMPTS) {
      toast.error('Generation kept getting cut off. Please try again.');
      return;
    }

    resumeAttempts.current += 1;
    logger.debug(`Auto-resume attempt ${resumeAttempts.current}/${MAX_RESUME_ATTEMPTS} (${mode})`);

    resumeTimeoutRef.current = setTimeout(() => {
      if (manualStopRef.current) {
        return;
      }

      if (mode === 'append') {
        append({ role: 'user', content: CONTINUE_PROMPT });
      } else {
        reload();
      }
    }, RESUME_DELAY_MS);
  };

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  /*
   * Merge continuation turns into single logical messages so both the artifact parser and the
   * UI see one continuous response. This keeps parsedMessages indexes aligned with what we
   * render below.
   */
  const displayMessages = useMemo(() => mergeContinuationMessages(messages), [messages]);

  /*
   * Stream phase for the activity indicator, derived from the RAW message content: while we
   * wait for the first token (K3 architect planning, or plain model latency) we're "thinking";
   * once the builder starts streaming actual content we're "building".
   */
  const lastDisplayMessage = displayMessages[displayMessages.length - 1];
  const streamPhase: 'thinking' | 'building' =
    isLoading && lastDisplayMessage?.role === 'assistant' && lastDisplayMessage.content.length > 0
      ? 'building'
      : 'thinking';

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(displayMessages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(displayMessages).catch((error) => toast.error(error.message));
    }
  }, [displayMessages, isLoading, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    manualStopRef.current = true;

    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }

    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    // A fresh user request resets the auto-resume bookkeeping.
    resumeAttempts.current = 0;
    manualStopRef.current = false;

    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);

      /**
       * If we have file modifications we append a new user message manually since we have to prefix
       * the user input with the file modifications and we don't want the new user input to appear
       * in the prompt. Using `append` is almost the same as `handleSubmit` except that we have to
       * manually reset the input and we'd have to manually pass in file attachments. However, those
       * aren't relevant here.
       */
      append({ role: 'user', content: `${diff}\n\n${_input}` });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: _input });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <BaseChat
      ref={animationScope}
      textareaRef={textareaRef}
      input={input}
      showChat={showChat}
      chatStarted={chatStarted}
      isStreaming={isLoading}
      streamPhase={streamPhase}
      enhancingPrompt={enhancingPrompt}
      promptEnhanced={promptEnhanced}
      sendMessage={sendMessage}
      messageRef={messageRef}
      scrollRef={scrollRef}
      handleInputChange={handleInputChange}
      handleStop={abort}
      messages={displayMessages.map((message, i) => {
        if (message.role === 'user') {
          return message;
        }

        return {
          ...message,
          content: parsedMessages[i] || '',
        };
      })}
      enhancePrompt={() => {
        enhancePrompt(input, (input) => {
          setInput(input);
          scrollTextArea();
        });
      }}
    />
  );
});
