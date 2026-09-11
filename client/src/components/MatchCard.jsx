import React from 'react';

/**
 * MatchCard — the inline patient-match card from My Desk (DeskForms.dc `match` field kind).
 * variant: 'found' (green) · 'multi' (amber) · 'dup' (red) · 'namesake' (neutral)
 * matches: [{ name, uhid?, tags?: [{label,bg,fg}], line1?, line2?,
 *             alert?, alertIcon?, actions?: [{label, icon, primary?, onClick}] }]
 * foot / footAction: grey footer line + optional outline button.
 */
const VARIANTS = {
  found: { bg: '#E9F7F1', border: '#BFE5D5', fg: '#12664F', icon: 'ti-user-check' },
  multi: { bg: '#FFF6E7', border: '#F0E2C6', fg: '#8A6B2E', icon: 'ti-users' },
  dup: { bg: '#FCEBEB', border: '#F7C1C1', fg: '#8E3232', icon: 'ti-alert-triangle' },
  namesake: { bg: '#FCFDFE', border: '#E3E8EF', fg: '#54658A', icon: 'ti-user-plus' },
};

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function patientMatchRow(p, actions) {
  if (!p) return null;
  const mobileStr = p.mobile || p.Mobile_No || '';
  const cleanMob = String(mobileStr).replace(/\D/g, '').slice(-10);
  const mobileDisplay = cleanMob ? `+91 ${cleanMob}` : '';

  return {
    id: p.id,
    name: p.name || p.Full_Name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Patient',
    tags: [{ label: 'Existing', bg: '#E1F5EE', fg: '#0F6E56' }],
    line1: mobileDisplay || undefined,
    actions
  };
}

export default function MatchCard({ variant = 'found', lead, matches = [], foot = null, footAction = null }) {
  const v = VARIANTS[variant] || VARIANTS.found;
  return (
    <div style={{ border: `1px solid ${v.border}`, borderRadius: 10, background: v.bg, overflow: 'hidden', marginTop: 10 }}>
      <div style={{ padding: '9px 13px', display: 'flex', alignItems: 'flex-start', gap: 8, borderBottom: `1px solid ${v.border}` }}>
        <i className={`ti ${v.icon}`} style={{ fontSize: 16, color: v.fg, flex: 'none', marginTop: 1 }} aria-hidden="true" />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: v.fg, lineHeight: 1.45 }}>{lead}</span>
      </div>

      {matches.map((m, i) => {
        if (!m) return null;
        return (
          <div key={m.id || m.uhid || i} style={{ padding: '12px 13px', background: '#fff', borderBottom: '1px solid #F1F4F8', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <div
              style={{
                flex: 'none',
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#E6F1FB',
                color: '#185FA5',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none'
              }}
            >
              {getInitials(m.name || '?')}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{m.name}</span>
                {m.uhid && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#54658A', fontVariantNumeric: 'tabular-nums' }}>#{m.uhid}</span>
                )}
                {(m.tags || []).map((t) => (
                  <span key={t.label} style={{ height: 19, padding: '0 8px', borderRadius: 5, background: t.bg, color: t.fg, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                    {t.label}
                  </span>
                ))}
              </div>
              {m.line1 && <span style={{ fontSize: 12.5, color: '#54658A' }}>{m.line1}</span>}
              {m.line2 && <span style={{ fontSize: 12, color: '#8A97AF' }}>{m.line2}</span>}
              {m.alert && (
                <span style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: '#8A6B2E', background: '#FFF6E7', borderRadius: 6, padding: '5px 8px', alignSelf: 'flex-start' }}>
                  <i className={`ti ${m.alertIcon || 'ti-clock-hour-4'}`} style={{ fontSize: 13 }} aria-hidden="true" />
                  {m.alert}
                </span>
              )}
              {(m.actions || []).length > 0 && (
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  {m.actions.map((a) => (
                    <button
                      type="button"
                      key={a.label}
                      onClick={a.onClick}
                      style={{
                        height: 29,
                        padding: '0 11px',
                        border: `1px solid ${a.primary ? '#0687BA' : '#D6E4ED'}`,
                        borderRadius: 7,
                        background: a.primary ? '#0687BA' : '#fff',
                        color: a.primary ? '#fff' : '#54658A',
                        font: 'inherit',
                        fontSize: 12,
                        fontWeight: a.primary ? 600 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.icon && <i className={`ti ${a.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />}
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {(foot || footAction) && (
        <div style={{ padding: '9px 13px', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          {foot && <span style={{ fontSize: 12, color: '#6B7C9E', minWidth: 0, lineHeight: 1.5 }}>{foot}</span>}
          {footAction && (
            <button
              type="button"
              onClick={footAction.onClick}
              style={{ marginLeft: 'auto', flex: 'none', height: 28, padding: '0 10px', border: '1px solid #D6E4ED', borderRadius: 7, background: '#fff', font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              {footAction.icon && <i className={`ti ${footAction.icon}`} style={{ fontSize: 14 }} aria-hidden="true" />}
              {footAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
