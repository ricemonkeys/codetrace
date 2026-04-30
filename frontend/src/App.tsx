import { useState, useEffect, useCallback, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import { AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types';

interface CodetraceState {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files?: BinaryFiles;
}

declare global {
  interface Window {
    __codetrace_initialContent?: string;
    __codetrace_onUpdate?: (content: string) => void;
    __codetrace_save: (content: string) => void;
  }
}

export default function App() {
  const [initialData] = useState<CodetraceState>(() => {
    const content = window.__codetrace_initialContent;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        return {
          elements: parsed.elements || [],
          appState: {
            ...(parsed.appState || {}),
            collaborators: new Map(),
          },
          files: parsed.files || {},
        };
      } catch (e) {
        console.error('Failed to parse initial content', e);
      }
    }
    return {
      elements: [],
      appState: { collaborators: new Map() },
      files: {},
    };
  });

  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const lastContentRef = useRef<string>(window.__codetrace_initialContent || '');
  const isUpdatingRef = useRef<boolean>(false);

  // 익스텐션으로부터 업데이트 수신
  useEffect(() => {
    window.__codetrace_onUpdate = (content: string) => {
      if (content === lastContentRef.current) return;
      
      try {
        const data = JSON.parse(content);
        if (excalidrawAPI) {
          isUpdatingRef.current = true;
          excalidrawAPI.updateScene({
            elements: data.elements || [],
            appState: {
              ...(data.appState || {}),
              collaborators: new Map(),
            },
            files: data.files || {},
          });
          lastContentRef.current = content;
          setTimeout(() => { isUpdatingRef.current = false; }, 100);
        }
      } catch (e) {
        console.error('Failed to parse update content', e);
      }
    };
  }, [excalidrawAPI]);

  // 변경사항을 익스텐션으로 전송
  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (isUpdatingRef.current) return;

    const { draggingElement, collaborators, ...saveAppState } = appState;
    
    const content = JSON.stringify({
      elements,
      appState: {
        ...saveAppState,
        collaborators: {},
      },
      files
    });

    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      window.__codetrace_save(content);
    }
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={initialData}
        onChange={handleChange}
      />
    </div>
  );
}
