import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';

/**
 * finishReason 'length' with EMPTY content means K3 spent the whole segment
 * reasoning and said nothing. That's a stall, not a truncation — order it to
 * stop thinking and start writing.
 */
const STALL_BREAKER_PROMPT =
  'You spent your entire output budget on reasoning and produced no code. Do NOT keep analyzing. Start writing the actual app NOW: open a <boltArtifact> tag and emit the first file in the build order immediately.';

/**
 * Consecutive all-thinking segments tolerated before giving up. Each stall
 * burns a full MAX_TOKENS of billed reasoning with zero visible output.
 */
const MAX_THINKING_STALLS = 2;

/**
 * Empty text part sent while no tokens are flowing (K3 planning/thinking is
 * silent — reasoning tokens are not forwarded by the AI SDK version in use).
 * Keeps the connection alive and the client state machine fed without
 * appending anything to the message.
 */
const HEARTBEAT_CHUNK = new TextEncoder().encode('0:""\n');
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Wraps a stream so long silent stretches still produce periodic heartbeat
 * chunks. Without this, the response sits at zero bytes for the entire
 * planning/thinking phase and the client (or an intermediary) can drop the
 * idle connection — which looked like "it just stopped thinking".
 */
function withHeartbeat(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      pendingRead = pendingRead ?? reader.read();

      const winner = await Promise.race([
        pendingRead,
        new Promise<'heartbeat'>((resolve) => setTimeout(() => resolve('heartbeat'), HEARTBEAT_INTERVAL_MS)),
      ]);

      if (winner === 'heartbeat') {
        // The read is still pending — keep it for the next pull.
        controller.enqueue(HEARTBEAT_CHUNK);
        return;
      }

      pendingRead = null;

      if (winner.done) {
        controller.close();
      } else {
        controller.enqueue(winner.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages } = await request.json<{ messages: Messages }>();

  const stream = new SwitchableStream();

  /**
   * Return the response IMMEDIATELY instead of awaiting the first streamText
   * call. Relay planning can run for minutes before the first token exists;
   * awaiting it held the entire request silent, which froze the UI and
   * risked idle connection drops. The heartbeat covers the silent window.
   */
  const response = new Response(withHeartbeat(stream.readable), {
    status: 200,
    headers: {
      contentType: 'text/plain; charset=utf-8',
    },
  });

  const run = (async () => {
    let thinkingStalls = 0;

    try {
      const options: StreamingOptions = {
        toolChoice: 'none',
        onFinish: async ({ text: content, finishReason }) => {
          if (finishReason !== 'length') {
            return stream.close();
          }

          if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
            /**
             * Budget exhausted: close cleanly. The old code THREW here, which
             * neither closed nor errored the stream — the client then sat on
             * "thinking" forever. That was the random mid-build freeze.
             */
            return stream.close();
          }

          const thinkingOnly = content.trim().length === 0;

          thinkingStalls = thinkingOnly ? thinkingStalls + 1 : 0;

          if (thinkingStalls > MAX_THINKING_STALLS) {
            console.log('[chat] segment budget burned by reasoning alone, ending stream');
            return stream.close();
          }

          const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

          console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

          messages.push({ role: 'assistant', content });
          messages.push({ role: 'user', content: thinkingOnly ? STALL_BREAKER_PROMPT : CONTINUE_PROMPT });

          const result = await streamText(messages, context.cloudflare.env, options);

          return stream.switchSource(result.toAIStream());
        },
      };

      const result = await streamText(messages, context.cloudflare.env, options);

      return stream.switchSource(result.toAIStream());
    } catch (error) {
      console.log(error);
      return stream.close();
    }
  })();

  // Keep the Pages Function alive after the response has been returned.
  context.cloudflare.ctx.waitUntil(run);

  return response;
}
