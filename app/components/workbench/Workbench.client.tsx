import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { FileGraph } from './FileGraph';
import { GitHubPanel } from './GitHubPanel.client';
import { Preview } from './Preview';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const viewOrder: WorkbenchViewType[] = ['code', 'graph', 'preview'];

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  middle: {
    value: 'graph',
    text: 'Graph',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const onGraphOpenFile = useCallback((filePath: string) => {
    workbenchStore.setSelectedFile(filePath);
    workbenchStore.currentView.set('code');
  }, []);

  const viewOffset = (view: WorkbenchViewType) => {
    if (view === selectedView) {
      return '0%';
    }

    return viewOrder.indexOf(view) < viewOrder.indexOf(selectedView) ? '-100%' : '100%';
  };

  return (
    chatStarted && (
      <motion.div
        initial="closed"
        animate={showWorkbench ? 'open' : 'closed'}
        variants={workbenchVariants}
        className="z-workbench"
      >
        <div
          className={classNames(
            'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'left-[var(--workbench-left)]': showWorkbench,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 px-6">
            <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
              <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                <div className="ml-auto" />
                <GitHubPanel />
                {selectedView === 'code' && (
                  <PanelHeaderButton
                    className="mr-1 text-sm"
                    onClick={() => {
                      workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                    }}
                  >
                    <div className="i-ph:terminal" />
                    Toggle Terminal
                  </PanelHeaderButton>
                )}
                <IconButton
                  icon="i-ph:x-circle"
                  className="-mr-1"
                  size="xl"
                  onClick={() => {
                    workbenchStore.showWorkbench.set(false);
                  }}
                />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <View initial={{ x: viewOffset('code') }} animate={{ x: viewOffset('code') }}>
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                <View initial={{ x: viewOffset('graph') }} animate={{ x: viewOffset('graph') }}>
                  <FileGraph files={files} onOpenFile={onGraphOpenFile} />
                </View>
                <View initial={{ x: viewOffset('preview') }} animate={{ x: viewOffset('preview') }}>
                  <Preview />
                </View>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
