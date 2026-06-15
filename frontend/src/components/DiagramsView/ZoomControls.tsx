import styles from './DiagramsView.module.css';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToView,
}: ZoomControlsProps) {
  const zoomPercentage = Math.round(zoom * 100);

  return (
    <div className={styles.zoomControls}>
      <div className={styles.zoomButtons}>
        <button className={styles.zoomButton} onClick={onZoomOut}>
          -
        </button>
        <span className={styles.zoomLevel}>{zoomPercentage}%</span>
        <button className={styles.zoomButton} onClick={onZoomIn}>
          +
        </button>
      </div>
      <button className={styles.fitButton} onClick={onFitToView}>
        Fit to View
      </button>
    </div>
  );
}
