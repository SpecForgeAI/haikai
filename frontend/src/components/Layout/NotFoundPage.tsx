/**
 * NotFoundPage
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 2
 *
 * Minimal 404 page rendered by the catch-all `<Route path="*">` at the end of
 * the routes tree. Intentionally tiny: a heading, a one-line message, and a
 * link back to the landing page. No marketing copy, no app chrome (no TopBar,
 * no architecture selector) -- the user is by definition off the locked URL
 * surface and we want to bounce them back to `/` cleanly rather than render a
 * shell that depends on an active architecture.
 */

import { Link } from 'react-router-dom';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.container} data-testid="not-found-page">
      <div className={styles.content}>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.message}>
          The page you are looking for does not exist or has been moved.
        </p>
        <Link to="/" className={styles.link}>
          Back to landing
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
