export function PaginationControls({
  pageNumber,
  hasPrevious,
  nextCursor,
  onPrevious,
  onNext,
}: {
  pageNumber: number;
  hasPrevious: boolean;
  nextCursor: string | null;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  if (!hasPrevious && !nextCursor) return null;

  return <nav className="pagination-controls" aria-label="List pages">
    <button type="button" className="button button-secondary" onClick={onPrevious} disabled={!hasPrevious}>Previous</button>
    <span aria-live="polite">Page {pageNumber}</span>
    <button type="button" className="button button-secondary" onClick={() => nextCursor && onNext(nextCursor)} disabled={!nextCursor}>Next</button>
  </nav>;
}
