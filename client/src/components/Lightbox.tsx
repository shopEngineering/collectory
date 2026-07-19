// Photo lightbox with keyboard nav (arrows + escape).
import { useEffect } from 'react';
import { Portal } from './ui';
import { Icon } from './Icon';
import type { Photo } from '../api/types';

export function Lightbox({
  photos,
  index,
  onClose,
  onIndex,
}: {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, photos.length, onClose, onIndex]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <Portal>
      <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <button className="lightbox-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        {photos.length > 1 && (
          <button
            className="lightbox-nav prev"
            onClick={() => onIndex((index - 1 + photos.length) % photos.length)}
            aria-label="Previous"
          >
            <Icon name="chevron-left" size={24} />
          </button>
        )}
        <img src={photo.url} alt={photo.caption || 'Photo'} />
        {photos.length > 1 && (
          <button
            className="lightbox-nav next"
            onClick={() => onIndex((index + 1) % photos.length)}
            aria-label="Next"
          >
            <Icon name="chevron-right" size={24} />
          </button>
        )}
        {(photo.caption || photos.length > 1) && (
          <div className="lightbox-caption">
            {photo.caption}
            {photos.length > 1 && <span style={{ opacity: 0.6 }}>{photo.caption ? '  ·  ' : ''}{index + 1} / {photos.length}</span>}
          </div>
        )}
      </div>
    </Portal>
  );
}
