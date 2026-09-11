import { useEffect, useState } from 'react';

/*
 * usePortalPop — fixed-position style for a control popup rendered via
 * createPortal(document.body).
 *
 * Anchors below the trigger (4px gap), flips above when there is not enough
 * room, tracks scroll/resize, and clamps to the right viewport edge.
 *
 *   matchWidth: true  → popup width = max(trigger width, minWidth)
 *   matchWidth: false → popup keeps its own CSS width (pass popWidth for the
 *                       right-edge clamp, e.g. the 292px date calendar)
 */
export function usePortalPop(triggerRef, open, {
  matchWidth = true,
  minWidth = 0,
  popWidth = null,
  estimatedHeight = 320,
} = {}) {
  const [style, setStyle] = useState({});

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = matchWidth ? Math.max(rect.width, minWidth) : (popWidth || rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      const base = {
        position: 'fixed',
        left: `${left}px`,
        right: 'auto',
        ...(matchWidth ? { width: `${width}px` } : null),
        zIndex: 20300,
      };
      setStyle(openUp
        ? { ...base, top: 'auto', bottom: `${Math.max(8, window.innerHeight - rect.top + 4)}px` }
        : { ...base, top: `${rect.bottom + 4}px`, bottom: 'auto' });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, triggerRef, matchWidth, minWidth, popWidth, estimatedHeight]);

  return style;
}
