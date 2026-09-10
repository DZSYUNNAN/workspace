import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { renderLatex } from './latex';

/** Mode B editor: CodeMirror 6 (stex) left · live preview right · error panel. */
export function LatexEditor(props: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const [debounced, setDebounced] = useState(props.value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(props.value), 250);
    return () => window.clearTimeout(t);
  }, [props.value]);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          history(),
          StreamLanguage.define(stexMath),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', background: 'var(--panel)' },
            '.cm-gutters': { background: 'var(--panel-2)', borderRight: '1px solid var(--border)', color: 'var(--text-3)' },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep external value changes (e.g. AI insert) in sync
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (props.value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.value },
      });
    }
  }, [props.value]);

  const rendered = useMemo(() => renderLatex(debounced), [debounced]);

  return (
    <div className="latex-split">
      <div className="latex-src" ref={hostRef} />
      <div className="latex-prev">
        <div className="latex-page" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
      {rendered.errors.length > 0 && (
        <div className="err-panel">
          {rendered.errors.map((e, i) => (
            <div key={i}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
