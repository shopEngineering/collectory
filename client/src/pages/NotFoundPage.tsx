// 404 fallback route ("*"). DESIGN §6.
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/bits';

export function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        message="That page doesn't exist, or may have moved. Let's get you back to your collections."
        action={
          <Link to="/" className="btn btn-primary">
            Back to Dashboard
          </Link>
        }
      />
    </div>
  );
}
