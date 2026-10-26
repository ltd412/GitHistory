import { Component, type ReactNode } from 'react';

/**
 * Contains a crash to the view that caused it: the centre pane shows the error and a way back
 * instead of React unmounting the whole window to a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="diff-msg">
        <p>This view hit an error:</p>
        <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--red)', fontSize: 11 }}>{this.state.error.message}</pre>
        <button className="btn" onClick={this.props.onReset}>
          Back to graph
        </button>
      </div>
    );
  }
}
