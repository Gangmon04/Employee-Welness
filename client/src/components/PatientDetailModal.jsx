import React from 'react';

export default function PatientDetailModal({ patient, onClose }) {
  if (!patient) return null;

  const subtitle = [
    patient.gender,
    patient.age ? `${patient.age} years` : null,
    patient.mobile ? (patient.mobile.startsWith('+91') ? patient.mobile : `+91 ${patient.mobile}`) : null
  ].filter(Boolean).join(' · ');

  const pairs = [
    { label: 'Patient ID', value: patient.id },
    { label: 'UHID', value: patient.uhid || '—' },
    { label: 'Full Name', value: patient.name },
    { label: 'Mobile', value: patient.mobile ? (patient.mobile.startsWith('+91') ? patient.mobile : `+91 ${patient.mobile}`) : '—' },
    { label: 'Email', value: patient.email || '—' },
    { label: 'Gender', value: patient.gender || '—' },
    { label: 'Age', value: patient.age ? `${patient.age} yrs` : '—' },
    { label: 'Date of Birth', value: patient.dateOfBirth || '—' },
    { label: 'Blood Group', value: patient.bloodGroup || '—' },
    { label: 'Address', value: patient.address || '—' }
  ];

  const handleCrmClick = () => {
    window.open(`https://pms.zohosolution.in/crm/tab/CustomModule1/${patient.id}`, '_blank');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(2px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#1e293b' }}>
                {patient.name}
              </h2>
              <span
                style={{
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 5,
                  background: '#E1F5EE',
                  color: '#0F6E56',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center'
                }}
              >
                Existing
              </span>
            </div>
            {subtitle && (
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#64748b',
              cursor: 'pointer',
              padding: 4,
              fontSize: 18,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <i className="ti ti-x" />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Personal Information
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '12px 16px',
              background: '#f8fafc',
              border: '1px solid #edf2f7',
              borderRadius: 8,
              padding: 14
            }}
          >
            {pairs.map((p) => (
              <div key={p.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11.5, color: '#8a97af', fontWeight: 500 }}>{p.label}</span>
                <span style={{ fontSize: 13.5, color: '#1e293b', fontWeight: 500, wordBreak: 'break-word' }}>{p.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #f1f5f9',
            background: '#fafafa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10
          }}
        >
          <button
            type="button"
            onClick={handleCrmClick}
            style={{
              height: 32,
              padding: '0 12px',
              border: '1px solid #d6e4ed',
              borderRadius: 6,
              background: '#ffffff',
              color: '#54658a',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <i className="ti ti-external-link" />
            Open in Zoho PMS CRM
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              height: 32,
              padding: '0 16px',
              border: 'none',
              borderRadius: 6,
              background: '#0687ba',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
