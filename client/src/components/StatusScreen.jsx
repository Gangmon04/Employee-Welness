import React from 'react'

/**
 * LoadingScreen matching user-portal design.
 * Centered quiet placeholder with Zoho branding, subtle pulse animation (shim),
 * and clean neutral background.
 */
export function LoadingScreen({ message = 'Loading appointment services…', logo = null }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: '#eef1f6',
        fontFamily: "'Zoho Puvi','Puvi',-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
        display: 'grid',
        placeItems: 'center',
        padding: '40px',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        @keyframes shim {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          gap: '14px',
          justifyItems: 'center',
          animation: 'shim 1.4s ease-in-out infinite'
        }}
      >
        <img
          src={logo || './zoho-logo.svg'}
          alt="Zoho"
          style={{ height: '24px', width: 'auto', opacity: 0.85 }}
        />
        <span style={{ fontSize: '13.5px', color: '#737d8b', fontWeight: 500, letterSpacing: '-0.01em' }}>
          {message}
        </span>
      </div>
    </div>
  )
}

/**
 * StatusScreen matching user-portal design.
 * Shown if the initial data read from Catalyst or CRM encounters an error,
 * providing a clear explanation and a single-click "Try again" retry button.
 */
export function StatusScreen({
  title = 'Something went wrong loading appointment services.',
  error = '',
  onRetry = null,
  logo = null
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: '#eef1f6',
        fontFamily: "'Zoho Puvi','Puvi',-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
        color: '#10151c',
        fontSize: '15px',
        lineHeight: 1.5,
        display: 'grid',
        placeItems: 'center',
        padding: 'clamp(20px, 5vw, 48px)',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          background: '#fdfdfe',
          borderRadius: '20px',
          padding: 'clamp(24px, 4vw, 40px)',
          boxShadow: '0 1px 2px rgba(16,21,28,.05), 0 10px 24px -16px rgba(16,21,28,.3)',
          maxWidth: '52ch',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <img
          src={logo || './zoho-logo.svg'}
          alt="Zoho"
          style={{ height: '24px', width: 'auto', display: 'block' }}
        />
        <h1
          style={{
            margin: '18px 0 0',
            fontSize: 'clamp(20px, 2.8vw, 24px)',
            fontWeight: 600,
            letterSpacing: '-.02em',
            lineHeight: 1.25,
            color: '#10151c'
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: '14.5px',
            color: '#454e5c',
            lineHeight: 1.6
          }}
        >
          {error || 'Unable to connect to the clinic scheduling system. Please check your connection and try again.'}
        </p>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: '22px',
              padding: '10px 22px',
              background: '#0052cc',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,82,204,0.25)',
              transition: 'background 0.15s ease'
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#0043a8')}
            onMouseOut={(e) => (e.currentTarget.style.background = '#0052cc')}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
