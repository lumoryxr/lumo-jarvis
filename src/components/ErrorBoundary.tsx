/**
 * M7-B: visual error boundary.
 *
 * Catches render-time errors anywhere under the tree and renders a
 * recovery panel. The user can choose to:
 *   - reload the app (full reset)
 *   - reload the workspace state (clears memory + tasks)
 *   - ignore (close the panel; the broken subtree stays unmounted)
 *
 * The boundary is intentionally tolerant: a render error in one
 * panel doesn't take down the whole UI.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What is this boundary protecting? Used in the recovery panel. */
  label?: string;
  /** Optional fallback element while we recover. */
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  resetting: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, resetting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '(root)', error, info);
    this.setState({ error, errorInfo: info });
  }

  reset = () => {
    this.setState({ resetting: true });
    queueMicrotask(() => this.setState({ error: null, errorInfo: null, resetting: false }));
  };

  fullReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  clearWorkspace = () => {
    try {
      // Best-effort wipe of the user-visible state keys.
      const keys = [
        'lumo.memories.v1',
        'lumo.tasks.v1',
        'lumo.activity.v1',
        'lumo.connector.status.v1',
        'lumo.proposals.v1',
        'lumo.mood.v1',
        'lumo.tunables.v1',
        'lumo.voice.uri',
        'lumo.voice.lang',
      ];
      for (const k of keys) localStorage.removeItem(k);
    } catch {}
    this.fullReload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { error, errorInfo } = this.state;
    return (
      <div className="error-boundary">
        <div className="error-boundary__panel">
          <div className="error-boundary__head">
            <span className="error-boundary__icon">⚠</span>
            <div className="error-boundary__title">
              <strong>{this.props.label ?? '组件'} 出错了</strong>
              <span className="label mono">{error?.name ?? 'Error'}</span>
            </div>
          </div>
          <pre className="error-boundary__msg">{error?.message ?? '(无消息)'}</pre>
          {errorInfo?.componentStack && (
            <details className="error-boundary__details">
              <summary>组件栈</summary>
              <pre className="error-boundary__stack">{errorInfo.componentStack}</pre>
            </details>
          )}
          <div className="error-boundary__actions">
            <button className="error-boundary__btn error-boundary__btn--primary" onClick={this.reset}>
              忽略并恢复
            </button>
            <button className="error-boundary__btn" onClick={this.clearWorkspace}>
              重置工作区
            </button>
            <button className="error-boundary__btn" onClick={this.fullReload}>
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
