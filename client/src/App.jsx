import { useState, useEffect, useMemo } from 'react'
import {
  getPmsServices,
  getPmsDoctors,
  getPmsPriorities,
  getPmsBookedAppointments,
  searchPmsPatient,
  createPmsAppointment
} from './services/pmsService'

const PRIORITIES = ['Routine', 'Urgent', 'ASAP', 'STAT']
// Morning session 09:00 - 13:00 (540-780m), Evening session 16:30 - 20:30 (990-1230m)
const SESSIONS = [[540, 780], [990, 1230]]

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const hhmm = (m) => {
  const h24 = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  const ap = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h).padStart(2, '0')}:${mm} ${ap}`
}

function getServiceIcon(serviceName = '') {
  const n = (serviceName || '').toLowerCase()
  if (n.includes('medic') || n.includes('general') || n.includes('physician') || n.includes('consult')) return 'ti-stethoscope'
  if (n.includes('dent') || n.includes('tooth') || n.includes('teeth')) return 'ti-dental'
  if (n.includes('cardio') || n.includes('heart')) return 'ti-heart-rate-monitor'
  if (n.includes('derma') || n.includes('skin')) return 'ti-sparkles'
  if (n.includes('eye') || n.includes('ophth')) return 'ti-eye'
  if (n.includes('ortho') || n.includes('bone')) return 'ti-bone'
  if (n.includes('paed') || n.includes('ped') || n.includes('child')) return 'ti-baby-carriage'
  if (n.includes('neuro') || n.includes('brain')) return 'ti-brain'
  if (n.includes('gyn') || n.includes('women')) return 'ti-gender-female'
  if (n.includes('ent') || n.includes('ear') || n.includes('nose')) return 'ti-ear'
  return 'ti-stethoscope'
}

export default function App() {
  // Live Data from PMS
  const [services, setServices] = useState([])
  const [doctors, setDoctors] = useState([])
  const [priorities, setPriorities] = useState(PRIORITIES)
  const [bookedSlots, setBookedSlots] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [fetchError, setFetchError] = useState('')

  // Wizard Step
  const [step, setStep] = useState(1)

  // Step 1: Selected Service from Services__s in PMS
  const [selectedServiceId, setSelectedServiceId] = useState(null)

  // Distinct live services from Services__s (deduplicated by name)
  const displayServices = useMemo(() => {
    const map = new Map()
    for (const s of services) {
      const key = (s.name || '').trim().toLowerCase()
      if (!key) continue
      if (!map.has(key) || s.id === '42735000000260145') {
        map.set(key, s)
      }
    }
    return Array.from(map.values())
  }, [services])

  // Step 2: Selected Doctor & Schedule
  const [selectedDoctorId, setSelectedDoctorId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)

  // Step 3: Patient Inputs & PMS Matching
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [mobile, setMobile] = useState('')
  const [matchedPatient, setMatchedPatient] = useState(null)
  const [searchingPatient, setSearchingPatient] = useState(false)
  const [apptName, setApptName] = useState('')
  const [apptEdited, setApptEdited] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [extra, setExtra] = useState('')
  const [priority, setPriority] = useState('Routine')

  // Status & errors
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [bookingRef, setBookingRef] = useState(null)

  // Load live Services and Doctors from PMS on mount
  useEffect(() => {
    let isMounted = true
    setLoadingData(true)
    setFetchError('')

    Promise.all([getPmsServices(), getPmsDoctors(), getPmsPriorities()])
      .then(([srvList, docList, prioList]) => {
        if (!isMounted) return
        setServices(srvList)
        setDoctors(docList)
        if (prioList?.length) setPriorities(prioList)

        // Select initial service if available
        if (srvList.length > 0) {
          setSelectedServiceId(srvList[0].id)
        }
        if (docList.length > 0) {
          setSelectedDoctorId(docList[0].id)
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('Failed to load PMS live data:', err)
        setFetchError(err.message || 'Unable to fetch live PMS services.')
      })
      .finally(() => {
        if (isMounted) setLoadingData(false)
      })

    return () => { isMounted = false }
  }, [])

  // Prepopulate from URL params if provided (?first=Ganga&last=Elumalai&mobile=9876543210)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('first')) setFirst(params.get('first'))
    if (params.get('last')) setLast(params.get('last'))
    if (params.get('mobile')) setMobile(params.get('mobile').replace(/\D/g, '').slice(-10))
  }, [])

  // Live Patient search in PMS when 10 digits are entered
  const cleanMobile = mobile.replace(/\D/g, '')
  useEffect(() => {
    if (cleanMobile.length === 10) {
      setSearchingPatient(true)
      searchPmsPatient(cleanMobile)
        .then((patient) => {
          if (patient) {
            setMatchedPatient(patient)
            if (!first && patient.firstName) setFirst(patient.firstName)
            if (!last && patient.lastName) setLast(patient.lastName)
          } else {
            setMatchedPatient(null)
          }
        })
        .catch(() => setMatchedPatient(null))
        .finally(() => setSearchingPatient(false))
    } else {
      setMatchedPatient(null)
    }
  }, [cleanMobile])

  // Fetch real booked appointments for the selected date
  useEffect(() => {
    if (selectedDate) {
      getPmsBookedAppointments(selectedDate)
        .then((slots) => setBookedSlots(slots))
        .catch(() => setBookedSlots([]))
    } else {
      setBookedSlots([])
    }
  }, [selectedDate])

  const selectedService = services.find((s) => String(s.id) === String(selectedServiceId)) || null
  const selectedDoctor = doctors.find((d) => String(d.id) === String(selectedDoctorId)) || null

  const autoName = () => {
    const patientFullName = `${first} ${last}`.trim()
    if (!selectedService) return ''
    return patientFullName ? `${selectedService.name} — ${patientFullName}` : selectedService.name
  }

  const effectiveApptName = apptEdited ? apptName : autoName()

  const clearError = (key) => {
    if (errors[key]) {
      const next = { ...errors }
      delete next[key]
      setErrors(next)
    }
  }

  // Generate 21-day calendar (Sundays disabled)
  const dates = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const list = []
    for (let i = 0; i < 21; i++) {
      const dt = new Date(today.getTime() + i * 86400000)
      const key = iso(dt)
      const closed = dt.getDay() === 0
      list.push({
        key,
        dow: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
        day: String(dt.getDate()).padStart(2, '0'),
        mon: dt.toLocaleDateString('en-IN', { month: 'short' }),
        disabled: closed
      })
    }
    return list
  }, [])

  // Generate time slots based on real Duration from Services__s
  const slotList = useMemo(() => {
    if (!selectedService || !selectedDoctor || !selectedDate) return []
    const out = []
    const duration = Number(selectedService.duration) || 30

    for (const [from, to] of SESSIONS) {
      for (let m = from; m + duration <= to; m += duration) {
        const label = hhmm(m)
        const isBooked = bookedSlots.includes(label)
        out.push({
          m,
          label,
          taken: isBooked
        })
      }
    }
    return out
  }, [selectedService, selectedDoctor, selectedDate, bookedSlots])

  const validate = () => {
    const errs = {}
    if (step === 1 && !selectedServiceId) errs.service = 'Select a service from PMS to continue.'
    if (step === 2) {
      if (!selectedDoctorId) errs.doctor = 'Select a doctor.'
      if (!selectedDate) errs.slot = 'Select an appointment date.'
      else if (!selectedSlot) errs.slot = 'Select a time slot.'
    }
    if (step === 3) {
      if (!first.trim()) errs.first = 'Enter the patient first name.'
      if (!last.trim()) errs.last = 'Enter the patient last name.'
      if (cleanMobile.length !== 10) errs.mobile = 'Enter a valid 10-digit mobile number.'
      if (!complaint.trim()) errs.complaint = 'Describe the patient’s complaint.'
    }
    return errs
  }

  const handleNext = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    if (step === 4) {
      // Create real appointment in PMS Appointments__s
      setSubmitting(true)
      setSubmitError('')
      try {
        const payload = {
          firstName: first.trim(),
          lastName: last.trim(),
          patientName: `${first} ${last}`.trim(),
          mobileNumber: cleanMobile,
          doctor: selectedDoctor ? { id: selectedDoctor.id, name: selectedDoctor.name } : null,
          doctorId: selectedDoctor?.id,
          service: selectedService ? { id: selectedService.id, name: selectedService.name, duration: selectedService.duration } : null,
          departmentId: selectedService?.id,
          duration: selectedService?.duration || 30,
          visitDate: selectedDate,
          startTime: selectedSlot,
          priority: priority || 'Routine',
          appointmentName: effectiveApptName || `${selectedService?.name} - ${first} ${last}`.trim(),
          chiefComplaint: complaint.trim(),
          additionalInfo: extra.trim()
        }

        const result = await createPmsAppointment(payload)
        const refId = result?.appointmentId || result?.id || 'PMS-SCHEDULED'
        setBookingRef(refId)
        setStep(5)
        setErrors({})
      } catch (err) {
        console.error('Appointment booking error:', err)
        setSubmitError(err.message || 'Failed to save appointment in PMS.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    setStep((prev) => prev + 1)
    setErrors({})
  }

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => prev - 1)
      setErrors({})
    }
  }

  const handleRestart = () => {
    setStep(1)
    if (services.length > 0) setSelectedServiceId(services[0].id)
    if (doctors.length > 0) setSelectedDoctorId(doctors[0].id)
    setSelectedDate(null)
    setSelectedSlot(null)
    setFirst('')
    setLast('')
    setMobile('')
    setMatchedPatient(null)
    setApptName('')
    setApptEdited(false)
    setComplaint('')
    setExtra('')
    setPriority('Routine')
    setErrors({})
    setSubmitError('')
    setBookingRef(null)
  }

  const dateLabel = selectedDate
    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    : 'Select a date below'

  const stepsRail = [
    { num: '1', label: 'Service', value: selectedService ? selectedService.name : 'Select from PMS' },
    { num: '2', label: 'Doctor & time', value: selectedDoctor && selectedSlot ? `${selectedDoctor.name} · ${selectedSlot}` : 'Pick doctor & slot' },
    { num: '3', label: 'Patient details', value: first || last ? `${first} ${last}`.trim() : 'Name and mobile' },
    { num: '4', label: 'Confirm', value: bookingRef ? String(bookingRef) : 'Review and book' }
  ]

  const summaryPairs = [
    { k: 'Patient', v: `${first} ${last}`.trim() || '—' },
    { k: 'Mobile', v: cleanMobile ? `+91 ${cleanMobile}` : '—' },
    { k: 'Service (PMS)', v: selectedService ? selectedService.name : '—' },
    { k: 'Doctor (PMS)', v: selectedDoctor ? selectedDoctor.name : '—' },
    { k: 'Date', v: dateLabel },
    { k: 'Time Slot', v: selectedSlot ? `${selectedSlot} (${selectedService?.duration || 30} mins)` : '—' }
  ]

  const detailRows = [
    { k: 'Appointment name', v: effectiveApptName || '—' },
    { k: 'Priority', v: priority },
    { k: 'Chief complaint', v: complaint || '—' },
    { k: 'Additional info', v: extra || '—' },
    { k: 'Target PMS Module', v: 'Appointments__s' }
  ]

  const cardStyle = (on) => ({
    textAlign: 'left',
    width: '100%',
    padding: '14px 16px',
    borderRadius: '10px',
    cursor: 'pointer',
    background: on ? '#f1f8fc' : '#ffffff',
    border: `1.5px solid ${on ? '#0687ba' : '#d6e4ed'}`,
    boxShadow: on ? '0 4px 12px rgba(6, 135, 186, 0.12)' : 'none',
    transition: 'all 0.15s ease'
  })

  return (
    <div style={{ minHeight: '100vh', background: '#e9ebee', display: 'flex', flexDirection: 'column' }}>
      {/* Brand Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: '#ffffff', borderBottom: '1px solid #e3e8ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0687ba', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flex: 'none' }}>
            SH
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#2f4268', lineHeight: 1.25 }}>Sugah Healthcorp</div>
            <div style={{ fontSize: 11.5, color: '#8a97af', lineHeight: 1.3 }}>PMS Live Appointment Service</div>
          </div>
          <div style={{ width: 1, height: 22, background: '#e3e8ef', marginLeft: 6 }}></div>
          <div style={{ fontSize: 12.5, color: '#6b7c9e', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <i className="ti ti-activity" style={{ fontSize: 15, color: '#1d9e75' }}></i>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Connected to PMS CRM (Services__s &amp; Appointments__s)
            </span>
          </div>
          <a
            href="tel:+917338742750"
            style={{
              marginLeft: 'auto',
              height: 30,
              padding: '0 12px',
              border: '1px solid #d6e4ed',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 500,
              color: '#0687ba',
              whiteSpace: 'nowrap'
            }}
          >
            <i className="ti ti-phone" style={{ fontSize: 14 }}></i>+91 73387 42750
          </a>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, width: '100%', maxWidth: 1120, margin: '0 auto', padding: '22px 20px 44px', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        
        {/* Step Navigation Sidebar */}
        <aside style={{ flex: '1 1 230px', maxWidth: 264, position: 'sticky', top: 78 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', marginBottom: 11 }}>
            Book appointment
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {stepsRail.map((st, i) => {
              const n = i + 1
              const on = step === n
              const past = step > n
              return (
                <li key={st.num}>
                  <button
                    type="button"
                    onClick={() => { if (n < step) { setStep(n); setErrors({}); } }}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 11px',
                      borderRadius: 9,
                      cursor: n < step ? 'pointer' : 'default',
                      font: 'inherit',
                      border: `1px solid ${on ? '#d6e4ed' : 'transparent'}`,
                      background: on ? '#ffffff' : 'transparent',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span
                      style={{
                        flex: 'none',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        background: past ? '#e6f6ef' : on ? '#0687ba' : '#e3e8ef',
                        color: past ? '#1d9e75' : on ? '#ffffff' : '#8a97af'
                      }}
                    >
                      {past ? <i className="ti ti-check" style={{ fontSize: 12 }}></i> : st.num}
                    </span>
                    <span style={{ display: 'block', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: on ? 600 : 500, color: '#2f4268' }}>
                        {st.label}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#8a97af', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {st.value}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div style={{ marginTop: 14, padding: '12px 14px', background: '#f8fafc', border: '1px solid #edf1f5', borderRadius: 9 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a97af' }}>
              PMS Live Integration
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.55, color: '#54658a' }}>
              Services are queried live from Zoho PMS <code>Services__s</code>. Bookings are registered immediately in <code>Appointments__s</code>.
            </p>
          </div>
        </aside>

        {/* Wizard Form Card */}
        <section
          style={{
            flex: '999 1 460px',
            minWidth: 'min(100%, 320px)',
            background: '#ffffff',
            borderRadius: 13,
            boxShadow: '0 8px 28px rgba(31, 45, 71, 0.10)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Card Step Header */}
          <div style={{ flex: 'none', padding: '15px 20px', borderBottom: '1px solid #edf1f5', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 600, color: '#2f4268' }}>
                {step === 1 ? 'Select Service' :
                 step === 2 ? 'Doctor and Schedule' :
                 step === 3 ? 'Patient Details' :
                 step === 4 ? 'Review and Confirm' : 'Appointment Confirmed'}
              </div>
              <div style={{ fontSize: 12.5, color: '#8a97af', lineHeight: 1.5 }}>
                {step === 1 ? 'Showing active clinical services fetched directly from PMS Services__s.' :
                 step === 2 ? 'Choose the attending practitioner and available clinic consultation slot.' :
                 step === 3 ? 'Enter patient contact information. Matches existing records in PMS Patient module.' :
                 step === 4 ? 'Review appointment parameters before recording in Appointments__s.' :
                 'Appointment has been recorded in Zoho PMS.'}
              </div>
            </div>
            <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 500, padding: '3px 9px', borderRadius: 20, background: '#edece8', color: '#2f4268', whiteSpace: 'nowrap' }}>
              {step === 5 ? 'Confirmed' : `Step ${step} of 4`}
            </span>
          </div>

          {/* Card Body */}
          <div style={{ padding: '18px 20px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* STEP 1: Live Services from Services__s */}
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                    Available Services (from PMS Services__s)
                  </span>
                  <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                </div>

                {loadingData && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: '#f8fafc', borderRadius: 8, border: '1px solid #edf1f5', color: '#54658a' }}>
                    <i className="ti ti-loader" style={{ fontSize: 18 }}></i>
                    <span style={{ fontSize: 13 }}>Fetching live services from PMS...</span>
                  </div>
                )}

                {fetchError && (
                  <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 8, color: '#c53030', fontSize: 12.5 }}>
                    {fetchError}
                  </div>
                )}

                {errors.service && <div style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.service}</div>}

                {!loadingData && displayServices.length === 0 && (
                  <div style={{ padding: '24px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: 8, border: '1px solid #edf1f5', color: '#6b7c9e', fontSize: 13 }}>
                    No services found in PMS Services__s module.
                  </div>
                )}

                {!loadingData && displayServices.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px 16px' }}>
                    {displayServices.map((s) => {
                      const on = String(s.id) === String(selectedServiceId)
                      const icon = getServiceIcon(s.name)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedServiceId(s.id)
                            setSelectedSlot(null)
                            clearError('service')
                          }}
                          style={cardStyle(on)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              style={{
                                flex: 'none',
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: on ? '#0687ba' : '#e6f3f9',
                                color: on ? '#ffffff' : '#056a91'
                              }}
                            >
                              <i className={`ti ${icon}`} style={{ fontSize: 18 }}></i>
                            </span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#2f4268', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {s.name}
                              </div>
                              <div style={{ fontSize: 11.5, color: '#8a97af' }}>
                                PMS ID: {s.id.slice(-6)}
                              </div>
                            </div>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#0687ba', background: '#e6f3f9', padding: '2px 7px', borderRadius: 12, whiteSpace: 'nowrap' }}>
                              {s.duration} min
                            </span>
                          </div>

                          <div style={{ marginTop: 10, fontSize: 12.5, color: '#54658a', lineHeight: 1.5 }}>
                            {s.description || 'Clinical consultation, diagnosis, and prescription management.'}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: '1px solid #edf1f5', fontSize: 11.5, color: '#8a97af' }}>
                            <span>Status: <strong style={{ color: '#1d9e75' }}>{s.status || 'Available'}</strong></span>
                            <span>{s.price > 0 ? `Fee: ₹${s.price}` : 'Consultation'}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Doctor and Schedule */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Doctor Selection from PMS Users */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                      Attending Practitioner (from PMS)
                    </span>
                    <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                    {errors.doctor && <span style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.doctor}</span>}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(252px, 1fr))', gap: '14px 16px' }}>
                    {doctors.map((d) => {
                      const on = String(d.id) === String(selectedDoctorId)
                      const initials = (d.name || 'DR').replace(/^Dr\.\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedDoctorId(d.id)
                            setSelectedSlot(null)
                            clearError('doctor')
                          }}
                          style={cardStyle(on)}
                        >
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                            <span
                              style={{
                                flex: 'none',
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                                background: on ? '#0687ba' : '#e6f3f9',
                                color: on ? '#ffffff' : '#056a91'
                              }}
                            >
                              {initials}
                            </span>
                            <div style={{ minWidth: 0, display: 'block' }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: '#2f4268' }}>{d.name}</div>
                              <div style={{ fontSize: 11.5, color: '#8a97af', lineHeight: 1.4 }}>{d.role || 'Consultant Specialist'}</div>
                              {d.email && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: '#8a97af' }}>
                                  <i className="ti ti-mail" style={{ fontSize: 12 }}></i>{d.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Schedule & Slot Picker */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                      Schedule &amp; Slots
                    </span>
                    <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px 16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                        Appointment date <span style={{ color: '#e24b4a' }}>*</span>
                      </span>
                      <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#2f4268' }}>
                        <i className="ti ti-calendar" style={{ fontSize: 15, color: '#8a97af' }}></i>{dateLabel}
                      </span>
                      <span style={{ fontSize: 11.5, color: '#8a97af' }}>Clinic closed on Sundays</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>Duration (from Services__s)</span>
                      <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f1f4f8', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#54658a' }}>
                        {selectedService ? `${selectedService.duration} mins` : '30 mins'}
                        <i className="ti ti-lock" style={{ fontSize: 14, color: '#8a97af', marginLeft: 'auto' }}></i>
                      </span>
                      <span style={{ fontSize: 11.5, color: '#8a97af' }}>Set on PMS Service record</span>
                    </div>
                  </div>

                  {/* 21-day Date Buttons */}
                  <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4 }}>
                    {dates.map((dt) => {
                      const on = dt.key === selectedDate
                      return (
                        <button
                          key={dt.key}
                          type="button"
                          disabled={dt.disabled}
                          onClick={() => {
                            if (!dt.disabled) {
                              setSelectedDate(dt.key)
                              setSelectedSlot(null)
                              clearError('slot')
                            }
                          }}
                          style={{
                            flex: 'none',
                            width: 58,
                            padding: '6px 0',
                            textAlign: 'center',
                            borderRadius: 7,
                            font: 'inherit',
                            cursor: dt.disabled ? 'not-allowed' : 'pointer',
                            background: on ? '#0687ba' : dt.disabled ? '#f1f4f8' : '#ffffff',
                            color: on ? '#ffffff' : dt.disabled ? '#a6b2c6' : '#2f4268',
                            border: `1px solid ${on ? '#0687ba' : '#d6e4ed'}`,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span style={{ display: 'block', fontSize: 10.5, textTransform: 'uppercase', opacity: 0.75 }}>{dt.dow}</span>
                          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{dt.day}</span>
                          <span style={{ display: 'block', fontSize: 10.5, opacity: 0.75 }}>{dt.mon}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Available Time Slots */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                      Available time slots <span style={{ color: '#e24b4a' }}>*</span>
                      {errors.slot && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#a32d2d' }}>{errors.slot}</span>}
                    </span>

                    {slotList.length > 0 ? (
                      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {slotList.map((s) => {
                          const on = selectedSlot === s.label
                          return (
                            <button
                              key={s.label}
                              type="button"
                              disabled={s.taken}
                              onClick={() => {
                                if (!s.taken) {
                                  setSelectedSlot(s.label)
                                  clearError('slot')
                                }
                              }}
                              style={{
                                height: 31,
                                padding: '0 11px',
                                borderRadius: 7,
                                font: 'inherit',
                                fontSize: 12.5,
                                whiteSpace: 'nowrap',
                                cursor: s.taken ? 'not-allowed' : 'pointer',
                                background: on ? '#0687ba' : s.taken ? '#f1f4f8' : '#f4f9fc',
                                color: on ? '#ffffff' : s.taken ? '#a6b2c6' : '#2f4268',
                                border: `1px solid ${on ? '#0687ba' : '#d6e4ed'}`,
                                textDecoration: s.taken ? 'line-through' : 'none',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {s.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', border: '1px solid #c4dcf7', borderRadius: 8, background: '#eef4fd', color: '#1a5aa8' }}>
                        <i className="ti ti-info-circle" style={{ fontSize: 16, flex: 'none', marginTop: 1 }}></i>
                        <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                          {!selectedDate ? 'Select a date above to display available consultation slots.' : 'No slots remain on this date. Please select another day.'}
                        </span>
                      </div>
                    )}
                    <span style={{ fontSize: 11.5, color: '#8a97af' }}>Times already scheduled in PMS Appointments__s are struck-through.</span>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Patient Details & Match */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Patient Information */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                      Patient Information
                    </span>
                    <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px 16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                        First name <span style={{ color: '#e24b4a' }}>*</span>
                      </span>
                      <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="text"
                          value={first}
                          onChange={(e) => { setFirst(e.target.value); clearError('first'); }}
                          placeholder="First name"
                          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13.5, height: '100%', padding: 0 }}
                        />
                      </span>
                      {errors.first && <span style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.first}</span>}
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                        Last name <span style={{ color: '#e24b4a' }}>*</span>
                      </span>
                      <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="text"
                          value={last}
                          onChange={(e) => { setLast(e.target.value); clearError('last'); }}
                          placeholder="Last name"
                          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13.5, height: '100%', padding: 0 }}
                        />
                      </span>
                      {errors.last && <span style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.last}</span>}
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                        Mobile number <span style={{ color: '#e24b4a' }}>*</span>
                      </span>
                      <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 'none', fontSize: 13, color: '#8a97af', display: 'flex', alignItems: 'center', gap: 7 }}>
                          +91<span style={{ width: 1, height: 16, background: '#e3e8ef' }}></span>
                        </span>
                        <input
                          type="tel"
                          value={mobile}
                          onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); clearError('mobile'); }}
                          placeholder="10-digit mobile"
                          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13.5, height: '100%', padding: 0 }}
                        />
                        {searchingPatient && <i className="ti ti-loader" style={{ fontSize: 15, color: '#0687ba' }}></i>}
                        {cleanMobile.length === 10 && !searchingPatient && (
                          <i className="ti ti-circle-check" style={{ fontSize: 15, color: '#1d9e75' }}></i>
                        )}
                      </span>
                      {errors.mobile && <span style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.mobile}</span>}
                    </label>
                  </div>

                  <span style={{ fontSize: 11.5, color: '#8a97af' }}>
                    Searches existing records in PMS Patient module. If new, registers a prospect profile automatically.
                  </span>

                  {matchedPatient && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', border: '1px solid #c4dcf7', borderRadius: 8, background: '#eef4fd', color: '#1a5aa8' }}>
                      <i className="ti ti-user-check" style={{ fontSize: 16, flex: 'none', marginTop: 1 }}></i>
                      <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                        <strong style={{ fontWeight: 600 }}>Matched Patient in PMS — {matchedPatient.name}</strong> (ID: {matchedPatient.id})<br />
                        This appointment will link to this existing Patient record in PMS.
                      </span>
                    </div>
                  )}
                </div>

                {/* Appointment Metadata */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                      Appointment Details
                    </span>
                    <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                  </div>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>Appointment name</span>
                    <span style={{ height: 34, padding: '0 10px', border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={effectiveApptName}
                        onChange={(e) => { setApptName(e.target.value); setApptEdited(true); }}
                        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13.5, height: '100%', padding: 0 }}
                      />
                    </span>
                    <span style={{ fontSize: 11.5, color: '#8a97af' }}>Formatted as required by PMS Appointments__s.</span>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>
                      Chief complaint <span style={{ color: '#e24b4a' }}>*</span>
                    </span>
                    <span style={{ border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', flexDirection: 'column' }}>
                      <textarea
                        rows={3}
                        value={complaint}
                        onChange={(e) => { setComplaint(e.target.value); clearError('complaint'); }}
                        placeholder="Describe the clinical symptoms or reason for visit"
                        style={{ minHeight: 66, resize: 'vertical', border: 'none', background: 'transparent', padding: '9px 11px', fontSize: 13.5, lineHeight: 1.55 }}
                      />
                    </span>
                    {errors.complaint && <span style={{ fontSize: 11.5, color: '#a32d2d' }}>{errors.complaint}</span>}
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>Additional information</span>
                    <span style={{ border: '1px solid #d6e4ed', borderRadius: 7, background: '#f4f9fc', display: 'flex', flexDirection: 'column' }}>
                      <textarea
                        rows={2}
                        value={extra}
                        onChange={(e) => setExtra(e.target.value)}
                        placeholder="Prior treatments, allergies, or notes for the doctor"
                        style={{ minHeight: 56, resize: 'vertical', border: 'none', background: 'transparent', padding: '9px 11px', fontSize: 13.5, lineHeight: 1.55 }}
                      />
                    </span>
                  </label>

                  {/* Priority Selector */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: '#54658a' }}>Priority (PMS Picklist)</span>
                    <div style={{ display: 'inline-flex', border: '1px solid #d6e4ed', borderRadius: 7, overflow: 'hidden', width: 'fit-content' }}>
                      {priorities.map((p, i) => {
                        const on = priority === p
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPriority(p)}
                            style={{
                              height: 32,
                              padding: '0 15px',
                              border: 'none',
                              borderLeft: i === 0 ? 'none' : '1px solid #d6e4ed',
                              font: 'inherit',
                              fontSize: 12.5,
                              cursor: 'pointer',
                              background: on ? '#0687ba' : '#ffffff',
                              color: on ? '#ffffff' : '#2f4268',
                              fontWeight: on ? 600 : 400,
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {p}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Review and Confirm */}
            {step === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {submitError && (
                  <div style={{ padding: '10px 14px', background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 8, color: '#c53030', fontSize: 12.5 }}>
                    {submitError}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '11px 16px', padding: '12px 14px', background: '#f8fafc', border: '1px solid #edf1f5', borderRadius: 9 }}>
                  {summaryPairs.map((p) => (
                    <div key={p.k} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#8a97af', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {p.k}
                      </span>
                      <span style={{ fontSize: 13.5, color: '#2f4268', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                        {p.v}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0687ba', whiteSpace: 'nowrap' }}>
                      PMS Record Details
                    </span>
                    <span style={{ height: 1, flex: 1, background: '#edf1f5' }}></span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {detailRows.map((r) => (
                      <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 168px) minmax(0, 1fr)', gap: 14, padding: '9px 0', borderBottom: '1px solid #edf1f5' }}>
                        <span style={{ fontSize: 12.5, color: '#8a97af' }}>{r.k}</span>
                        <span style={{ fontSize: 13.5, color: '#2f4268', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', border: '1px solid #c4dcf7', borderRadius: 8, background: '#eef4fd', color: '#1a5aa8' }}>
                  <i className="ti ti-info-circle" style={{ fontSize: 16, flex: 'none', marginTop: 1 }}></i>
                  <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    Clicking "Book appointment" will execute <code>POST /v3/Appointments__s</code> on PMS and generate a live record.
                  </span>
                </div>
              </div>
            )}

            {/* STEP 5: Appointment Confirmed */}
            {step === 5 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ flex: 'none', width: 42, height: 42, borderRadius: '50%', background: '#e6f6ef', color: '#1d9e75', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ti ti-check" style={{ fontSize: 21 }}></i>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 16.5, fontWeight: 600, color: '#2f4268' }}>Appointment confirmed</span>
                    <span style={{ fontSize: 12.5, color: '#8a97af' }}>
                      {selectedService?.name} · {selectedDoctor?.name} · {dateLabel} at {selectedSlot}
                    </span>
                  </span>
                </div>

                <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #edf1f5', borderRadius: 9 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#8a97af', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    PMS Appointment ID
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#0687ba', marginTop: 3 }}>{bookingRef}</div>
                </div>

                <p style={{ margin: 0, fontSize: 12.5, color: '#54658a', lineHeight: 1.6 }}>
                  Appointment has been successfully saved in Zoho PMS <code>Appointments__s</code> for +91 {cleanMobile}.
                </p>

                <div>
                  <button
                    type="button"
                    onClick={handleRestart}
                    style={{
                      height: 34,
                      padding: '0 16px',
                      border: '1px solid #d6e4ed',
                      borderRadius: 8,
                      background: '#ffffff',
                      fontSize: 13,
                      color: '#2f4268',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <i className="ti ti-plus" style={{ fontSize: 15 }}></i>Book another appointment
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Card Footer Navigation */}
          {step <= 4 && (
            <div style={{ flex: 'none', padding: '13px 20px', borderTop: '1px solid #edf1f5', background: '#fcfdfe', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleBack}
                style={{
                  height: 34,
                  padding: '0 16px',
                  border: '1px solid #d6e4ed',
                  borderRadius: 8,
                  background: '#ffffff',
                  fontSize: 13,
                  color: '#2f4268',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  visibility: step === 1 ? 'hidden' : 'visible'
                }}
              >
                <i className="ti ti-chevron-left" style={{ fontSize: 15 }}></i>Back
              </button>

              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8a97af' }}>
                {step === 1 ? (selectedService ? `${selectedService.duration}-minute service selected` : 'Select a service from PMS') :
                 step === 2 ? (selectedSlot ? `${dateLabel} at ${selectedSlot}` : 'Doctor, date and time required') :
                 step === 3 ? 'Fields marked * are required' :
                 'Creates appointment in PMS Appointments__s'}
              </span>

              <button
                type="button"
                disabled={submitting || (step === 1 && services.length === 0)}
                onClick={handleNext}
                style={{
                  height: 34,
                  padding: '0 18px',
                  border: 'none',
                  borderRadius: 8,
                  background: '#0687ba',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.8 : 1
                }}
              >
                {submitting ? 'Booking in PMS...' : step === 4 ? 'Book appointment' : 'Continue'}
                <i className={submitting ? 'ti ti-loader' : step === 4 ? 'ti ti-check' : 'ti ti-chevron-right'} style={{ fontSize: 15 }}></i>
              </button>
            </div>
          )}

        </section>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #e3e8ef', background: '#ffffff' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '14px 20px', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#8a97af' }}>
          <span>Sugah Healthcorp · Chengalpet, Tamil Nadu 603202</span>
          <span style={{ marginLeft: 'auto' }}>
            Connected to Zoho PMS CRM
          </span>
        </div>
      </footer>
    </div>
  )
}
