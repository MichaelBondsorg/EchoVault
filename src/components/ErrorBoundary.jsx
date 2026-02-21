import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Error Boundary component to catch JavaScript errors anywhere in the child component tree
 * Displays a user-friendly error message instead of a white screen
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Optionally reload the page
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-warm-50 via-white to-lavender-50 dark:from-hearth-950 dark:via-hearth-900 dark:to-hearth-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-hearth-900 rounded-2xl shadow-xl dark:shadow-none dark:ring-1 dark:ring-hearth-700 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 bg-honey-100 dark:bg-honey-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-honey-600 dark:text-honey-400" />
            </div>

            <h1 className="text-2xl font-bold text-hearth-900 dark:text-hearth-100 mb-2">
              Something went wrong
            </h1>

            <p className="text-hearth-600 dark:text-hearth-400 mb-6">
              We encountered an unexpected error. This might be a temporary issue.
              Please try again or reload the page.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-honey-500 text-white rounded-xl hover:bg-honey-600 dark:bg-honey-600 dark:hover:bg-honey-500 transition-colors font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>

              <button
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-hearth-100 text-hearth-700 rounded-xl hover:bg-hearth-200 dark:bg-hearth-700 dark:text-hearth-200 dark:hover:bg-hearth-600 transition-colors font-medium"
              >
                Reload Page
              </button>
            </div>

            {/* Show error details in development */}
            {import.meta.env.DEV && this.state.error && (
              <div className="mt-6 p-4 bg-red-50 dark:bg-red-950/30 rounded-xl text-left">
                <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">
                  Error Details (Dev Only):
                </p>
                <pre className="text-xs text-red-700 dark:text-red-400 overflow-auto max-h-32">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </div>
            )}

            <p className="mt-6 text-sm text-hearth-500 dark:text-hearth-400">
              If this problem persists, please contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
