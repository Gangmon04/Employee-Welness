import { useEffect } from 'react';

/**
 * Close-on-click-outside for control popups. Active only while `active` is true.
 * `refOrRefs` accepts one ref or an array — pass [rootRef, popRef] when the
 * popup is portalled to <body> (it is no longer inside the root DOM node).
 */
export function useClickOutside(refOrRefs, onOutside, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const refs = Array.isArray(refOrRefs) ? refOrRefs : [refOrRefs];
    const handler = (e) => {
      const inside = refs.some((r) => r?.current && r.current.contains(e.target));
      if (!inside) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [refOrRefs, onOutside, active]);
}
