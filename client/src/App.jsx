import { useState, useEffect, useMemo } from 'react'
import {
  getPmsServices,
  getPmsDoctors,
  getPmsPriorities,
  getPmsBookedAppointments,
  searchPmsPatient,
  createPmsAppointment,
  getPmsHospitalInfo,
  getPmsScheduleConfig
} from './services/pmsService'
import DateField from './components/DateField'
import MatchCard, { patientMatchRow } from './components/MatchCard'
import PatientDetailModal from './components/PatientDetailModal'
import { LoadingScreen, StatusScreen } from './components/StatusScreen'
import './App.css'

const PRIORITIES = ['Routine', 'Urgent', 'ASAP', 'STAT']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const hhmm = (m) => {
  const h24 = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  const ap = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h).padStart(2, '0')}:${mm} ${ap}`
}

function parseTimeToMins(timeStr) {
  if (!timeStr) return null
  const trimmed = String(timeStr).trim().toUpperCase()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i)
  if (!match) return null
  let h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const ap = match[3]
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + m
}

function formatClinicHours(bh) {
  if (!bh) return null
  if (typeof bh === 'string') {
    if (bh.includes('Sunday') && bh.includes('Monday')) {
      return '24 Hours'
    }
    return bh
  }
  const type = String(bh.type || '').toLowerCase()
  if (type.includes('24') || bh.is_24_7 || (bh.same_as_everyday === true && (!bh.daily_timing || bh.daily_timing.length === 0))) {
    return '24 Hours'
  }
  const formatTime = (t) => {
    if (!t) return ''
    if (/am|pm/i.test(t)) return t
    const parts = String(t).split(':')
    let h = parseInt(parts[0], 10)
    const m = parts[1] || '00'
    const ap = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m} ${ap}`
  }
  if (Array.isArray(bh.daily_timing) && bh.daily_timing.length >= 2) {
    const s = formatTime(bh.daily_timing[0])
    const e = formatTime(bh.daily_timing[1])
    return (s && e) ? `${s} – ${e}` : '24 Hours'
  }
  if (Array.isArray(bh.custom_timing) && bh.custom_timing.length > 0) {
    const first = bh.custom_timing[0]
    const timing = first.daily_timing || first.timing || first.business_timing || first.shift_timing
    if (Array.isArray(timing) && timing.length >= 2) {
      const s = formatTime(timing[0])
      const e = formatTime(timing[1])
      return (s && e) ? `${s} – ${e}` : '24 Hours'
    }
  }
  return '24 Hours'
}

function getWorkingBlocksForDate(dateStr, businessHours, doctorShift) {
  if (!dateStr) return []
  const dt = new Date(`${dateStr}T12:00:00`)
  const dayName = DAY_NAMES[dt.getDay()]

  // 1. Check doctor's specific shift hours if assigned
  if (doctorShift) {
    const shiftDays = doctorShift.business_days || doctorShift.days || []
    if (shiftDays.length === 0 || shiftDays.includes(dayName)) {
      if (Array.isArray(doctorShift.daily_timing) && doctorShift.daily_timing.length >= 2) {
        const startM = parseTimeToMins(doctorShift.daily_timing[0])
        let endM = parseTimeToMins(doctorShift.daily_timing[1])
        if (endM === 0 || doctorShift.daily_timing[1]?.includes('12:00 AM') || doctorShift.daily_timing[1] === '24:00') {
          endM = 1440
        }
        if (startM !== null && endM !== null && endM > startM) {
          return [[startM, endM]]
        }
      }
      if (Array.isArray(doctorShift.custom_timing)) {
        const ct = doctorShift.custom_timing.find(c => c.days === dayName || c.days?.includes(dayName))
        const timing = ct?.daily_timing || ct?.timing || ct?.business_timing
        if (Array.isArray(timing) && timing.length >= 2) {
          const startM = parseTimeToMins(timing[0])
          let endM = parseTimeToMins(timing[1])
          if (endM === 0 || timing[1]?.includes('12:00 AM') || timing[1] === '24:00') {
            endM = 1440
          }
          if (startM !== null && endM !== null && endM > startM) {
            return [[startM, endM]]
          }
        }
      }
    } else {
      // Doctor has assigned shift hours, but this day is an off-day
      return []
    }
  }

  // 2. Organization Business Hours (fallback when doctor has no shift hours assigned)
  if (businessHours) {
    const rawDays = businessHours.business_days || []
    const isWorkingDay = rawDays.length === 0 || rawDays.includes(dayName)
    if (!isWorkingDay) return []

    const typeStr = String(businessHours.type || '').toLowerCase()
    const bhValStr = String(businessHours.business_hours || '').toLowerCase()
    if (typeStr.includes('24') || bhValStr.includes('24')) {
      // Full 24 Hours: round-the-clock 00:00 to 24:00 (0 to 1440 minutes)
      return [[0, 1440]]
    }

    if (businessHours.same_as_everyday && Array.isArray(businessHours.daily_timing) && businessHours.daily_timing.length >= 2) {
      const startM = parseTimeToMins(businessHours.daily_timing[0])
      let endM = parseTimeToMins(businessHours.daily_timing[1])
      if (endM === 0 || businessHours.daily_timing[1]?.includes('12:00 AM') || businessHours.daily_timing[1] === '24:00') {
        endM = 1440
      }
      if (startM !== null && endM !== null && endM > startM) {
        return [[startM, endM]]
      }
    }

    if (Array.isArray(businessHours.custom_timing)) {
      const ct = businessHours.custom_timing.find(c => c.days === dayName || c.days?.includes(dayName))
      const timing = ct?.business_timing || ct?.daily_timing || ct?.timing
      if (Array.isArray(timing) && timing.length >= 2) {
        const startM = parseTimeToMins(timing[0])
        let endM = parseTimeToMins(timing[1])
        if (endM === 0 || timing[1]?.includes('12:00 AM') || timing[1] === '24:00') {
          endM = 1440
        }
        if (startM !== null && endM !== null && endM > startM) {
          return [[startM, endM]]
        }
      }
    }
  }

  // Default fallback for 24 hours: 00:00 to 24:00
  return [[0, 1440]]
}


function getServiceIcon(serviceName = '') {
  const n = (serviceName || '').toLowerCase()
  if (n.includes('medic') || n.includes('general') || n.includes('physician') || n.includes('consult')) return 'ti-stethoscope'
  if (n.includes('derma') || n.includes('skin')) return 'ti-mood-smile'
  if (n.includes('ortho') || n.includes('bone')) return 'ti-bone'
  if (n.includes('paed') || n.includes('ped') || n.includes('child')) return 'ti-baby-carriage'
  if (n.includes('cardio') || n.includes('heart')) return 'ti-heart-rate-monitor'
  if (n.includes('physio') || n.includes('therapy')) return 'ti-run'
  if (n.includes('dent') || n.includes('tooth') || n.includes('teeth')) return 'ti-dental'
  if (n.includes('eye') || n.includes('ophth')) return 'ti-eye'
  if (n.includes('neuro') || n.includes('brain')) return 'ti-brain'
  if (n.includes('gyn') || n.includes('women')) return 'ti-gender-female'
  if (n.includes('ent') || n.includes('ear') || n.includes('nose')) return 'ti-ear'
  return 'ti-stethoscope'
}

function DoctorAvatar({ doctor, isSelected, initials }) {
  const [imgError, setImgError] = useState(false)
  const imageSrc = doctor?.id
    ? (doctor.image && doctor.image.startsWith('/server')
        ? doctor.image
        : `/server/pms_appointment_service/doctor-image?id=${doctor.id}${doctor.zuid ? `&zuid=${doctor.zuid}` : ''}`)
    : doctor?.image
  const hasImage = Boolean(imageSrc && !imgError)

  return (
    <span className={`doctor-avatar ${isSelected ? 'is-selected' : ''}`}>
      {hasImage ? (
        <img
          src={imageSrc}
          alt={doctor.name || initials}
          className="doctor-avatar-img"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="doctor-avatar-initials">{initials}</span>
      )}
    </span>
  )
}

function getHospitalInitials(name = '') {
  if (!name) return 'H'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export default function App() {
  // Live Data from PMS
  const [hospitalInfo, setHospitalInfo] = useState(null)
  const [hospitalLogoError, setHospitalLogoError] = useState(false)
  const [scheduleConfig, setScheduleConfig] = useState({
    businessHours: null,
    holidays: [],
    unavailabilities: [],
    shiftHours: []
  })
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
      if (!map.has(key)) {
        map.set(key, { ...s, members: [...(s.members || [])] })
      } else {
        const existing = map.get(key)
        const combinedMembers = [...(existing.members || [])]
        for (const m of (s.members || [])) {
          if (!combinedMembers.some((em) => String(em.id) === String(m.id))) {
            combinedMembers.push(m)
          }
        }
        map.set(key, {
          ...existing,
          ...s,
          members: combinedMembers,
          doctorCount: Math.max(combinedMembers.length, existing.doctorCount || 0, s.doctorCount || 0)
        })
      }
    }
    return Array.from(map.values())
  }, [services])

  // Step 2: Selected Doctor & Schedule
  const [selectedDoctorId, setSelectedDoctorId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [timeFilter, setTimeFilter] = useState('all')
  const todayKey = useMemo(() => iso(new Date()), [])

  // Step 3: Patient Inputs & PMS Matching
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [mobile, setMobile] = useState('')
  const [matchedPatient, setMatchedPatient] = useState(null)
  const [detailPatient, setDetailPatient] = useState(null)
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

  // Load live Services, Doctors, and Schedule Configuration from PMS on mount or retry
  const loadData = () => {
    setLoadingData(true)
    setFetchError('')

    Promise.all([
      getPmsServices(),
      getPmsDoctors(),
      getPmsPriorities(),
      getPmsHospitalInfo(),
      getPmsScheduleConfig()
    ])
      .then(([srvList, docList, prioList, hosp, sched]) => {
        setServices(srvList || [])
        setDoctors(docList || [])
        if (prioList?.length) setPriorities(prioList)
        if (hosp) setHospitalInfo(hosp)
        if (sched) setScheduleConfig(sched)

        if (srvList?.length > 0) {
          setSelectedServiceId(srvList[0].id)
        }
        if (docList?.length > 0) {
          setSelectedDoctorId(docList[0].id)
        }
      })
      .catch((err) => {
        console.error('Failed to load clinic data:', err)
        setFetchError('Unable to load clinical departments right now. Please check your connection and try again.')
      })
      .finally(() => {
        setLoadingData(false)
      })
  }

  useEffect(() => {
    loadData()
  }, [])

  // Sync document title with hospital name
  useEffect(() => {
    if (hospitalInfo?.name) {
      document.title = `Book Appointment | ${hospitalInfo.name}`
    }
  }, [hospitalInfo?.name])

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

  // Fetch real booked appointments for the selected date and doctor
  useEffect(() => {
    if (selectedDate && selectedDoctorId) {
      getPmsBookedAppointments(selectedDate, selectedDoctorId)
        .then((slots) => setBookedSlots(slots))
        .catch(() => setBookedSlots([]))
    } else {
      setBookedSlots([])
    }
  }, [selectedDate, selectedDoctorId])

  const selectedService = displayServices.find((s) => String(s.id) === String(selectedServiceId)) || services.find((s) => String(s.id) === String(selectedServiceId)) || null

  // Filter to show only doctors associated with the selected service in PMS
  const availableDoctors = useMemo(() => {
    if (!selectedService) return doctors

    const serviceMemberIds = new Set(
      (selectedService.members || []).map((m) => String(m.id || m))
    )
    const serviceMemberNames = new Set(
      (selectedService.members || []).map((m) => (m.name || '').trim().toLowerCase()).filter(Boolean)
    )

    if (serviceMemberIds.size === 0 && serviceMemberNames.size === 0) {
      return doctors
    }

    const matched = doctors.filter((d) =>
      serviceMemberIds.has(String(d.id)) ||
      serviceMemberNames.has((d.name || '').trim().toLowerCase())
    )

    return matched.length > 0 ? matched : doctors
  }, [selectedService, doctors])

  const selectedDoctor = availableDoctors.find((d) => String(d.id) === String(selectedDoctorId)) || doctors.find((d) => String(d.id) === String(selectedDoctorId)) || null

  // Ensure selectedDoctorId is always one of the available doctors for the selected service
  useEffect(() => {
    if (availableDoctors.length > 0) {
      const exists = availableDoctors.some((d) => String(d.id) === String(selectedDoctorId))
      if (!exists) {
        setSelectedDoctorId(availableDoctors[0].id)
        setSelectedSlot(null)
      }
    }
  }, [availableDoctors, selectedDoctorId])

  const autoName = () => {
    const patientFullName = `${first} ${last}`.trim()
    if (!selectedService) return ''
    return patientFullName ? `${selectedService.name} — ${patientFullName}` : selectedService.name
  }

  const effectiveApptName = apptEdited ? apptName : autoName()

  const typedFullName = `${first} ${last}`.trim().toLowerCase()
  const matchedFullName = (matchedPatient?.name || '').trim().toLowerCase()
  const isExactOrPrefillMatch = Boolean(
    matchedPatient && (
      !first.trim() ||
      !last.trim() ||
      matchedFullName === typedFullName ||
      (matchedFullName.includes(first.toLowerCase().trim()) && matchedFullName.includes(last.toLowerCase().trim()))
    )
  )

  const clearError = (key) => {
    if (errors[key]) {
      const next = { ...errors }
      delete next[key]
      setErrors(next)
    }
  }

  // Generate 21-day calendar based on live Business Hours, Holidays, Doctor Leave, and Elapsed Times
  const dates = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const list = []

    const bh = scheduleConfig.businessHours
    const bhDays = bh?.business_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

    const holidayDates = new Map()
    for (const h of (scheduleConfig.holidays || [])) {
      const hStart = (h.date || h.start_date || h.from || '').slice(0, 10)
      if (hStart) {
        holidayDates.set(hStart, h.name || 'Clinic Holiday')
      }
    }

    // Check doctor full-day leaves
    const doctorLeaveDates = new Set()
    if (selectedDoctorId) {
      for (const u of (scheduleConfig.unavailabilities || [])) {
        const uDocId = String(u.user_id?.id || u.user_id || u.user?.id || u.user || '')
        if (uDocId && uDocId !== String(selectedDoctorId)) continue
        const uStart = (u.from || u.start_date || '').slice(0, 10)
        const isFull = u.all_day === true || !u.from?.includes('T') || (u.from && u.to && (new Date(u.to) - new Date(u.from) >= 23 * 3600 * 1000))
        if (isFull && uStart) {
          doctorLeaveDates.add(uStart)
        }
      }
    }

    // Find doctor shift if any
    const docShift = (scheduleConfig.shiftHours || []).find((s) => {
      if (Array.isArray(s.users)) {
        return s.users.some((u) => String(u.id || u) === String(selectedDoctorId))
      }
      return false
    })

    // Generate dates covering at least 21 days, or extending if selectedDate is further ahead
    let daysCount = 21
    if (selectedDate) {
      const selDt = new Date(selectedDate + 'T00:00:00')
      const diffDays = Math.ceil((selDt.getTime() - today.getTime()) / 86400000)
      if (diffDays >= 21) {
        daysCount = Math.min(diffDays + 7, 90)
      }
    }

    for (let i = 0; i < daysCount; i++) {
      const dt = new Date(today.getTime() + i * 86400000)
      const key = iso(dt)
      const dayName = DAY_NAMES[dt.getDay()]
      const isClosedDay = !bhDays.includes(dayName)
      const holidayName = holidayDates.get(key)
      const isDoctorLeave = doctorLeaveDates.has(key)

      // Working blocks for this specific date
      const blocks = getWorkingBlocksForDate(key, bh, docShift)
      const isDayOff = blocks.length === 0

      // For today: check if all possible slots have already passed
      let allSlotsPassed = false
      if (key === todayKey) {
        const latestSlotStart = blocks.reduce((max, [start, end]) => Math.max(max, end - 30), 0)
        if (nowMinutes >= latestSlotStart || blocks.length === 0) {
          allSlotsPassed = true
        }
      }

      const disabled = isClosedDay || Boolean(holidayName) || isDoctorLeave || isDayOff || allSlotsPassed

      let statusReason = ''
      if (allSlotsPassed) statusReason = 'All slots for today have ended'
      else if (holidayName) statusReason = `Clinic Holiday: ${holidayName}`
      else if (isDoctorLeave) statusReason = 'Doctor on leave'
      else if (isClosedDay || isDayOff) statusReason = `Closed on ${dayName}s`

      list.push({
        key,
        dow: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
        day: String(dt.getDate()).padStart(2, '0'),
        mon: dt.toLocaleDateString('en-IN', { month: 'short' }),
        disabled,
        isHoliday: Boolean(holidayName),
        isOnLeave: isDoctorLeave,
        isPast: allSlotsPassed,
        reason: statusReason
      })
    }
    return list
  }, [scheduleConfig, selectedDoctorId, selectedDate])

  // Select the first enabled date automatically on initial load
  useEffect(() => {
    if (!selectedDate) {
      const firstActive = dates.find((d) => !d.disabled)
      if (firstActive) {
        setSelectedDate(firstActive.key)
      }
    }
  }, [dates, selectedDate])

  // Generate time slots based on real Duration, Working Blocks, Doctor Unavailability, and Bookings
  const slotList = useMemo(() => {
    if (!selectedService || !selectedDoctor || !selectedDate) return []
    const duration = Number(selectedService.duration) || 30

    // Find doctor shift if any
    const docShift = (scheduleConfig.shiftHours || []).find((s) => {
      if (Array.isArray(s.users)) {
        return s.users.some((u) => String(u.id || u) === String(selectedDoctor.id))
      }
      return false
    })

    const workingBlocks = getWorkingBlocksForDate(selectedDate, scheduleConfig.businessHours, docShift)
    if (workingBlocks.length === 0) return []

    // Doctor partial unavailabilities for this date
    const partialLeaves = []
    for (const u of (scheduleConfig.unavailabilities || [])) {
      const uDocId = String(u.user_id?.id || u.user_id || u.user?.id || u.user || '')
      if (uDocId && uDocId !== String(selectedDoctor.id)) continue
      const uStartStr = u.from || u.start_date || ''
      const uEndStr = u.to || u.end_date || ''
      if (uStartStr.startsWith(selectedDate)) {
        const fromM = parseTimeToMins(uStartStr.includes('T') ? uStartStr.slice(11, 16) : u.start_time)
        const toM = parseTimeToMins(uEndStr.includes('T') ? uEndStr.slice(11, 16) : u.end_time)
        if (fromM !== null && toM !== null && toM > fromM) {
          partialLeaves.push([fromM, toM])
        }
      }
    }

    const now = new Date()
    const todayKey = iso(now)
    const isToday = selectedDate === todayKey
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const out = []
    for (const [from, to] of workingBlocks) {
      for (let m = from; m + duration <= to; m += duration) {
        // If selected date is today, skip past times!
        if (isToday && m <= nowMinutes) {
          continue
        }

        const label = hhmm(m)
        const isBooked = bookedSlots.includes(label)
        const isOnLeave = partialLeaves.some(([lf, lt]) => m < lt && m + duration > lf)

        out.push({
          m,
          label,
          taken: isBooked || isOnLeave,
          reason: isBooked ? 'Already booked' : isOnLeave ? 'Doctor unavailable' : ''
        })
      }
    }
    return out
  }, [selectedService, selectedDoctor, selectedDate, scheduleConfig, bookedSlots])

  // Count and filter slots by period of day
  const filterCounts = useMemo(() => {
    let morning = 0, afternoon = 0, evening = 0, night = 0
    for (const s of slotList) {
      if (s.m >= 360 && s.m < 720) morning++
      else if (s.m >= 720 && s.m < 1020) afternoon++
      else if (s.m >= 1020 && s.m < 1260) evening++
      else night++
    }
    return { all: slotList.length, morning, afternoon, evening, night }
  }, [slotList])

  const displaySlots = useMemo(() => {
    if (timeFilter === 'morning') return slotList.filter((s) => s.m >= 360 && s.m < 720)
    if (timeFilter === 'afternoon') return slotList.filter((s) => s.m >= 720 && s.m < 1020)
    if (timeFilter === 'evening') return slotList.filter((s) => s.m >= 1020 && s.m < 1260)
    if (timeFilter === 'night') return slotList.filter((s) => s.m >= 1260 || s.m < 360)
    return slotList
  }, [slotList, timeFilter])

  const validate = () => {
    const errs = {}
    if (step === 1 && !selectedServiceId) errs.service = 'Please choose a department to continue.'
    if (step === 2) {
      if (!selectedDoctorId) errs.doctor = 'Select a doctor.'
      if (!selectedDate) errs.slot = 'Select an appointment date.'
      else if (!selectedSlot) errs.slot = 'Select a time slot.'
    }
    if (step === 3) {
      if (!first.trim()) errs.first = 'Enter the first name.'
      if (!last.trim()) errs.last = 'Enter the last name.'
      if (cleanMobile.length !== 10) errs.mobile = 'Enter a 10-digit mobile number.'
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
          matchedPatientId: isExactOrPrefillMatch ? (matchedPatient?.id || null) : null,
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
        const refId = result?.appointmentId || result?.id || 'CONFIRMED'
        setBookingRef(refId)
        setStep(5)
        setErrors({})
      } catch (err) {
        console.error('Appointment booking error:', err)
        setSubmitError('Unable to confirm your appointment right now. Please choose another slot or try again.')
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
    setDetailPatient(null)
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

  const formatReviewDate = (dateStr) => {
    if (!dateStr) return '—'
    const dt = new Date(dateStr + 'T00:00:00')
    const dow = dt.toLocaleDateString('en-US', { weekday: 'short' })
    const day = dt.getDate()
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
    const mon = months[dt.getMonth()] || dt.toLocaleDateString('en-US', { month: 'short' })
    const year = dt.getFullYear()
    return `${dow}, ${day} ${mon}, ${year}`
  }

  const stepsRail = [
    { num: '1', label: 'Department', value: selectedService ? selectedService.name : 'Choose department' },
    { num: '2', label: 'Doctor & time', value: selectedDoctor && selectedSlot ? `${selectedDoctor.name} · ${selectedSlot}` : 'Pick doctor & slot' },
    { num: '3', label: 'Patient details', value: first || last ? `${first} ${last}`.trim() : 'Name and mobile' },
    { num: '4', label: 'Confirm', value: bookingRef ? String(bookingRef) : 'Review and book' }
  ]

  const reviewRows = [
    { label: 'Patient', value: `${first} ${last}`.trim() || '—' },
    { label: 'Mobile', value: cleanMobile ? `+91 ${cleanMobile}` : '—' },
    { label: 'Department', value: selectedService ? selectedService.name : '—' },
    {
      label: 'Doctor',
      value: selectedDoctor
        ? (selectedDoctor.name.startsWith('Dr.') ? selectedDoctor.name : `Dr. ${selectedDoctor.name}`)
        : '—'
    },
    { label: 'Date', value: formatReviewDate(selectedDate) },
    {
      label: 'Time',
      value: selectedSlot ? `${selectedSlot} · ${selectedService?.duration || 30} mins` : '—'
    },
    {
      label: 'Appointment name',
      value: effectiveApptName
        ? effectiveApptName.replace(/\s+-\s+/, ' — ')
        : (selectedService && (first || last) ? `${selectedService.name} — ${first} ${last}`.trim() : '—')
    },
    { label: 'Priority', value: priority || 'Routine' },
    { label: 'Chief complaint', value: complaint.trim() || '—' },
    { label: 'Additional info', value: extra.trim() || '—' }
  ]

  if (loadingData) {
    return <LoadingScreen message="Loading appointment services…" />
  }

  if (fetchError && (!services || services.length === 0)) {
    return (
      <StatusScreen
        title="Unable to load appointment services"
        error={fetchError}
        onRetry={loadData}
      />
    )
  }

  return (
    <div className="app-shell">
      {/* Brand Header (My Desk Model) */}
      <header className="app-header">
        <div className="app-header__inner">
          {hospitalInfo?.image && !hospitalLogoError ? (
            <div className="ph-avatar ph-avatar--image">
              <img
                src={hospitalInfo.image}
                alt={hospitalInfo.name || 'Hospital Logo'}
                className="ph-avatar-img"
                onError={() => setHospitalLogoError(true)}
              />
            </div>
          ) : hospitalInfo?.name ? (
            <div className="ph-avatar">
              {getHospitalInitials(hospitalInfo.name)}
            </div>
          ) : null}
          <div className="app-header__meta">
            {hospitalInfo?.name && (
              <div className="ph-title">
                {hospitalInfo.name}
              </div>
            )}
            {(hospitalInfo?.address || hospitalInfo?.practiceType) && (
              <div className="ph-subtitle" title={hospitalInfo.address || hospitalInfo.practiceType}>
                {hospitalInfo.address || hospitalInfo.practiceType}
              </div>
            )}
          </div>
          {hospitalInfo?.businessHours && (
            <>
              <div className="app-header__divider"></div>
              <div className="app-header__badge-wrap">
                <span className="avail-rec-badge" title="Clinic Business Hours">
                  <i className="ti ti-clock"></i>
                  <span>Clinic Hours: {formatClinicHours(hospitalInfo.businessHours)}</span>
                </span>
              </div>
            </>
          )}
          {hospitalInfo?.phone && (
            <a
              href={`tel:${hospitalInfo.phone}`}
              className="app-header__phone"
              title={`Call ${hospitalInfo.phone}`}
            >
              <i className="ti ti-phone"></i>
              <span className="app-header__phone-text">{hospitalInfo.phone.startsWith('+') ? hospitalInfo.phone : `+91 ${hospitalInfo.phone}`}</span>
            </a>
          )}
        </div>

        {/* Mobile Header Stepper: 4-Segment Progress Bar + Step Eyebrow (Image 1 design) */}
        <div className="mobile-header-stepper">
          <div className="mobile-progress-stepper">
            <div
              onClick={() => { if (step > 1) { setStep(1); setErrors({}); } }}
              className={`mobile-progress-seg ${step > 1 ? 'is-completed is-clickable' : step === 1 ? 'is-active' : ''}`}
              title={step > 1 ? 'Go back to Step 1' : ''}
            ></div>
            <div
              onClick={() => { if (step > 2) { setStep(2); setErrors({}); } }}
              className={`mobile-progress-seg ${step > 2 ? 'is-completed is-clickable' : step === 2 ? 'is-active' : ''}`}
              title={step > 2 ? 'Go back to Step 2' : ''}
            ></div>
            <div
              onClick={() => { if (step > 3) { setStep(3); setErrors({}); } }}
              className={`mobile-progress-seg ${step > 3 ? 'is-completed is-clickable' : step === 3 ? 'is-active' : ''}`}
              title={step > 3 ? 'Go back to Step 3' : ''}
            ></div>
            <div className={`mobile-progress-seg ${step > 4 ? 'is-completed' : step === 4 ? 'is-active' : ''}`}></div>
          </div>
          <div className="mobile-step-eyebrow">
            <span className="mobile-step-eyebrow__badge">
              {step === 5 ? 'CONFIRMED' : `STEP ${step} OF 4`}
            </span>
            <span className="mobile-step-eyebrow__topic">
              {step === 1 ? 'Department' :
               step === 2 ? 'Doctor, Date & Time' :
               step === 3 ? 'Patient Details' :
               step === 4 ? 'Review & Confirm' : 'Appointment Confirmed'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="app-main">
        
        {/* Step Navigation Sidebar */}
        <aside className="app-sidebar">
          <div className="app-sidebar__title">
            Book appointment
          </div>
          <ol className="steps-rail">
            {stepsRail.map((st, i) => {
              const n = i + 1
              const on = step === n
              const past = step > n
              return (
                <li key={st.num}>
                  <button
                    type="button"
                    onClick={() => { if (n < step) { setStep(n); setErrors({}); } }}
                    className={`step-rail-btn ${on ? 'is-active' : ''} ${past ? 'is-past' : 'is-disabled'}`}
                  >
                    <span className={`step-rail-badge ${past ? 'is-past' : on ? 'is-active' : ''}`}>
                      {past ? <i className="ti ti-check"></i> : st.num}
                    </span>
                    <span className="step-rail-info">
                      <span className={`step-rail-label ${on ? 'is-active' : ''}`}>
                        {st.label}
                      </span>
                      <span className="step-rail-sub">
                        {st.value}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="pms-info-card">
            <div className="pms-info-card__title">
             At the clinic
            </div>
            <p className="pms-info-card__desc">
             Appointments booked here are created in the clinic's records. Carry a photo ID and report to the front desk ten minutes early.
            </p>
          </div>
        </aside>

        {/* Wizard Form Card */}
        <section className="wizard-card">
          {/* Card Step Header */}
          <div className="wizard-card__header">
            <div className="wizard-card__title-group">
              <div className="wizard-card__title">
                {step === 1 ? 'Book appointment' :
                 step === 2 ? 'Doctor and time' :
                 step === 3 ? 'Patient Details' :
                 step === 4 ? 'Review and Confirm' : 'Appointment Confirmed'}
              </div>
            </div>
            <span className="dsk-chip dsk-chip--brand">
              {step === 5 ? 'Confirmed' : `Step ${step} of 4`}
            </span>
          </div>

          {/* Card Body */}
          <div className="wizard-card__body">
            
            {/* STEP 1: Live Services from Services__s */}
            {step === 1 && (
              <div className="step-flow">
                <div className="section-divider">
                  <span className="section-divider__label">
                   Department
                  </span>
                  <span className="section-divider__line"></span>
                </div>

                {loadingData && (
                  <div className="loading-banner">
                    <i className="ti ti-loader"></i>
                    <span>Loading clinical departments...</span>
                  </div>
                )}

                {fetchError && displayServices.length > 0 && (
                  <div className="error-banner">
                    Unable to refresh departments right now. Showing available cached services.
                  </div>
                )}

                {errors.service && <div className="section-error">{errors.service}</div>}

                {!loadingData && displayServices.length === 0 && (
                  <div className="empty-banner" style={{ padding: '36px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>🩺</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#10151c', marginBottom: '6px' }}>
                      No consultation services available right now
                    </div>
                    <p style={{ fontSize: '14px', color: '#667085', maxWidth: '420px', margin: '0 auto 20px', lineHeight: 1.5 }}>
                      We couldn't retrieve the list of active clinical departments. Please check your internet connection or try refreshing.
                    </p>
                    <button
                      type="button"
                      onClick={loadData}
                      className="btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}
                    >
                      <i className="ti ti-refresh"></i>
                      Refresh services
                    </button>
                  </div>
                )}

                {!loadingData && displayServices.length > 0 && (
                  <div className="cards-grid">
                    {displayServices.map((s) => {
                      const on = String(s.id) === String(selectedServiceId)
                      const icon = getServiceIcon(s.name)
                      const docCount = s.doctorCount ?? (Array.isArray(s.members) ? s.members.length : 0)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedServiceId(s.id)
                            setSelectedSlot(null)
                            clearError('service')
                          }}
                          className={`select-card ${on ? 'is-selected' : ''}`}
                        >
                          <div className="service-card__top">
                            <span className={`service-card__icon ${on ? 'is-selected' : ''}`}>
                              <i className={`ti ${icon}`}></i>
                            </span>
                            <div className="service-card__info">
                              <div className="service-card__title">
                                {s.name}
                              </div>
                              <div className="service-card__meta-line">
                                <span>{s.duration} min</span>
                                <span className="service-card__meta-dot">•</span>
                                <span>{docCount} {docCount === 1 ? 'doctor' : 'doctors'}</span>
                              </div>
                            </div>
                            <span className="service-card__badge desktop-only">
                              {s.duration} min
                            </span>
                            <i className="ti ti-chevron-right select-card__chevron"></i>
                          </div>

                          <div className="service-card__desc desktop-only">
                            {s.description || 'Fever, infections, blood pressure and diabetes review.'}
                          </div>

                          <div className="service-card__footer desktop-only">
                            <span className="service-card__doc-count">
                              <strong className="service-card__status">
                                {docCount > 0 ? `${docCount} ${docCount === 1 ? 'Doctor Available' : 'Doctors Available'}` : 'Doctors Available'}
                              </strong>
                            </span>
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
              <div className="step-flow--lg">
                {/* Doctor Selection from PMS Users */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      {selectedService ? `Doctors for ${selectedService.name}` : 'Doctor'}
                    </span>
                    <span className="section-divider__line"></span>
                    {errors.doctor && <span className="section-error push-right">{errors.doctor}</span>}
                  </div>

                  <div className="doctors-grid">
                    {availableDoctors.map((d) => {
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
                          className={`select-card ${on ? 'is-selected' : ''}`}
                        >
                          <div className="doctor-card__row">
                            <DoctorAvatar doctor={d} isSelected={on} initials={initials} />
                            <div className="doctor-card__info">
                              <div className="doctor-name" title={d.name}>{d.name}</div>
                              {d.medicalDegrees && (
                                <div className="doctor-degrees" title={d.medicalDegrees}>{d.medicalDegrees}</div>
                              )}
                              <div className="doctor-role" title={d.role || 'Consultant Specialist'}>{d.role || 'Consultant Specialist'}</div>
                              {d.email && (
                                <div className="doctor-email desktop-only" title={d.email}>
                                  <i className="ti ti-mail"></i>
                                  <span className="doctor-email__text">{d.email}</span>
                                </div>
                              )}
                            </div>
                            <i className="ti ti-chevron-right select-card__chevron"></i>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Schedule & Slot Picker */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Schedule &amp; Slots
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  <div className="schedule-params-grid">
                    <div className="form-group">
                      <label className="form-label">
                        Appointment date <span className="form-required">*</span>
                      </label>
                      <DateField
                        value={selectedDate ? new Date(`${selectedDate}T00:00:00`) : null}
                        minDate={new Date()}
                        onChange={(d) => {
                          const pad = (n) => String(n).padStart(2, '0')
                          setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
                          setSelectedSlot(null)
                          clearError('slot')
                        }}
                        error={!!errors.slot && !selectedDate}
                      />
                      <span className="form-hint">Choose a date or pick below</span>
                    </div>

                    <div className="form-group">
                      <span className="form-label">Duration</span>
                      <span className="form-control form-control--readonly">
                        {selectedService ? `${selectedService.duration} mins` : '30 mins'}
                        <i className="ti ti-lock icon-right"></i>
                      </span>
                      <span className="form-hint">From the service record</span>
                    </div>
                  </div>

                  {/* 21-day Date Buttons */}
                  <div className="date-strip">
                    {dates.map((dt) => {
                      const on = dt.key === selectedDate
                      const holidayClass = dt.isHoliday ? 'is-holiday' : ''
                      const leaveClass = dt.isOnLeave ? 'is-on-leave' : ''
                      const pastClass = dt.isPast ? 'is-past' : ''
                      return (
                        <button
                          key={dt.key}
                          type="button"
                          disabled={dt.disabled}
                          title={dt.reason || (dt.disabled ? 'Unavailable' : dt.dow)}
                          onClick={() => {
                            if (!dt.disabled) {
                              setSelectedDate(dt.key)
                              setSelectedSlot(null)
                              clearError('slot')
                            }
                          }}
                          className={`date-btn ${on ? 'is-selected' : ''} ${holidayClass} ${leaveClass} ${pastClass}`}
                        >
                          <span className="date-btn__dow">{dt.dow}</span>
                          <span className="date-btn__day">{dt.day}</span>
                          <span className="date-btn__mon">{dt.mon}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Available Time Slots */}
                  <div className="form-group">
                    <span className="form-label">
                      Available time slots <span className="form-required">*</span>
                      {errors.slot && <span className="section-error push-right">{errors.slot}</span>}
                    </span>

                    {/* Time of Day Period Filter Tabs for 24-Hour Slots */}
                    {slotList.length > 0 && (
                      <div className="slot-filter-tabs">
                        <button
                          type="button"
                          onClick={() => setTimeFilter('all')}
                          className={`slot-filter-btn ${timeFilter === 'all' ? 'is-active' : ''}`}
                        >
                          All ({filterCounts.all})
                        </button>
                        {filterCounts.morning > 0 && (
                          <button
                            type="button"
                            onClick={() => setTimeFilter('morning')}
                            className={`slot-filter-btn ${timeFilter === 'morning' ? 'is-active' : ''}`}
                          >
                            Morning ({filterCounts.morning})
                          </button>
                        )}
                        {filterCounts.afternoon > 0 && (
                          <button
                            type="button"
                            onClick={() => setTimeFilter('afternoon')}
                            className={`slot-filter-btn ${timeFilter === 'afternoon' ? 'is-active' : ''}`}
                          >
                            Afternoon ({filterCounts.afternoon})
                          </button>
                        )}
                        {filterCounts.evening > 0 && (
                          <button
                            type="button"
                            onClick={() => setTimeFilter('evening')}
                            className={`slot-filter-btn ${timeFilter === 'evening' ? 'is-active' : ''}`}
                          >
                            Evening ({filterCounts.evening})
                          </button>
                        )}
                        {filterCounts.night > 0 && (
                          <button
                            type="button"
                            onClick={() => setTimeFilter('night')}
                            className={`slot-filter-btn ${timeFilter === 'night' ? 'is-active' : ''}`}
                          >
                            Night ({filterCounts.night})
                          </button>
                        )}
                      </div>
                    )}

                    {slotList.length > 0 ? (
                      displaySlots.length > 0 ? (
                        <div className="slots-grid">
                          {displaySlots.map((s) => {
                            const on = selectedSlot === s.label
                            return (
                              <button
                                key={s.label}
                                type="button"
                                disabled={s.taken}
                                title={s.reason || undefined}
                                onClick={() => {
                                  if (!s.taken) {
                                    setSelectedSlot(s.label)
                                    clearError('slot')
                                  }
                                }}
                                className={`slot-btn ${on ? 'is-selected' : ''} ${s.taken ? 'is-taken' : ''}`}
                              >
                                {s.label}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="info-banner">
                          <i className="ti ti-info-circle"></i>
                          <span>No slots available in this time window. Select "All" above to see all slots.</span>
                        </div>
                      )
                    ) : (
                      <div className="info-banner">
                        <i className="ti ti-info-circle"></i>
                        <span>
                          {!selectedDate
                            ? 'Select a date above to display available consultation slots.'
                            : selectedDate === iso(new Date())
                            ? 'All consultation slots for today have ended. Please select an upcoming date.'
                            : 'No slots remain on this date. Please select another day.'}
                        </span>
                      </div>
                    )}

                    {/* <div className="schedule-hint-row">
                      <span className="form-hint">
                        {scheduleConfig.businessHours?.type === '24_by_7' || String(scheduleConfig.businessHours?.business_hours).includes('24')
                          ? 'Clinic open 24 Hours (Mon – Sun) · 24/7 round-the-clock consultation slots'
                          : hospitalInfo?.businessHours
                          ? `Clinic Hours: ${hospitalInfo.businessHours}`
                          : 'Consultation slots follow clinic hours and doctor shift schedule.'}
                      </span>
                    </div> */}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Patient Details & Match */}
            {step === 3 && (
              <div className="step-flow--lg">
                {/* Patient Information */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Patient Information
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  <div className="form-grid-3">
                    <label className="form-group">
                      <span className="form-label">
                        First name <span className="form-required">*</span>
                      </span>
                      <span className="form-control">
                        <input
                          type="text"
                          value={first}
                          onChange={(e) => { setFirst(e.target.value); clearError('first'); }}
                          placeholder="First name"
                        />
                      </span>
                      {errors.first && <span className="section-error">{errors.first}</span>}
                    </label>

                    <label className="form-group">
                      <span className="form-label"> Last name <span className="form-required">*</span></span>
                      <span className="form-control">
                        <input
                          type="text"
                          value={last}
                          onChange={(e) => { setLast(e.target.value); clearError('last'); }}
                          placeholder="Last name"
                        />
                      </span>
                      {errors.last && <span className="section-error">{errors.last}</span>}
                    </label>

                    <label className="form-group">
                      <span className="form-label">
                        Mobile number <span className="form-required">*</span>
                      </span>
                      <span className="form-control">
                        <span className="phone-prefix">
                          +91<span className="phone-prefix__divider"></span>
                        </span>
                        <input
                          type="tel"
                          value={mobile}
                          onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); clearError('mobile'); }}
                          placeholder="10-digit mobile"
                        />
                        {searchingPatient && <i className="ti ti-loader icon-loader"></i>}
                        {cleanMobile.length === 10 && !searchingPatient && (
                          <i className="ti ti-circle-check icon-check"></i>
                        )}
                      </span>
                      {errors.mobile && <span className="section-error">{errors.mobile}</span>}
                    </label>
                  </div>

                  {matchedPatient && !searchingPatient && (
                    isExactOrPrefillMatch ? (
                      <MatchCard
                        variant="found"
                        lead="Existing patient found — this appointment will be booked under their record, so history and balance stay in one place."
                        matches={[
                          patientMatchRow(matchedPatient, [
                            {
                              label: 'View full record',
                              icon: 'ti-external-link',
                              onClick: () => setDetailPatient(matchedPatient)
                            }
                          ])
                        ]}
                        foot="Name and mobile number both match this record, so the appointment is booked under it. To book someone else, change the name or the number."
                      />
                    ) : (
                      <MatchCard
                        variant="multi"
                        lead="A patient is registered on this mobile number — pick one, or keep the typed name to book a new patient on the same number."
                        matches={[
                          patientMatchRow(matchedPatient, [
                            {
                              label: 'Use this patient',
                              icon: 'ti-user-check',
                              primary: true,
                              onClick: () => {
                                const parts = String(matchedPatient.name || '').trim().split(/\s+/)
                                setFirst(matchedPatient.firstName || parts[0] || '')
                                setLast(matchedPatient.lastName || parts.slice(1).join(' ') || '')
                              }
                            },
                            {
                              label: 'View full record',
                              icon: 'ti-external-link',
                              onClick: () => setDetailPatient(matchedPatient)
                            }
                          ])
                        ]}
                        foot="A shared family phone is normal — the name you type is matched against the patient you pick."
                      />
                    )
                  )}
                </div>

                {/* Appointment Metadata */}
                <div className="step-flow">
                  <div className="section-divider">
                    <span className="section-divider__label">
                      Appointment Details
                    </span>
                    <span className="section-divider__line"></span>
                  </div>

                  <label className="form-group">
                    <span className="form-label">Appointment name</span>
                    <span className="form-control">
                      <input
                        type="text"
                        value={effectiveApptName}
                        onChange={(e) => { setApptName(e.target.value); setApptEdited(true); }}
                      />
                    </span>
                  </label>

                  <label className="form-group">
                    <span className="form-label">
                      Chief complaint <span className="form-required">*</span>
                    </span>
                    <span className="form-control-textarea">
                      <textarea
                        rows={3}
                        value={complaint}
                        onChange={(e) => { setComplaint(e.target.value); clearError('complaint'); }}
                        placeholder="Describe the clinical symptoms or reason for visit"
                      />
                    </span>
                    {errors.complaint && <span className="section-error">{errors.complaint}</span>}
                  </label>

                  <label className="form-group">
                    <span className="form-label">Additional information</span>
                    <span className="form-control-textarea">
                      <textarea
                        rows={2}
                        value={extra}
                        onChange={(e) => setExtra(e.target.value)}
                        placeholder="Prior treatments, allergies, or notes for the doctor"
                      />
                    </span>
                  </label>

                  {/* Priority Selector */}
                  <div className="form-group">
                    <span className="form-label">Priority</span>
                    <div className="priority-group">
                      {priorities.map((p) => {
                        const on = priority === p
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPriority(p)}
                            className={`priority-btn ${on ? 'is-active' : ''}`}
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
              <div className="step-flow">
                {submitError && (
                  <div className="error-banner">
                    {submitError}
                  </div>
                )}

                <div className="review-card-table">
                  {reviewRows.map((r) => (
                    <div key={r.label} className="review-row">
                      <span className="review-label">{r.label}</span>
                      <span className="review-value">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 5: Appointment Confirmed */}
            {step === 5 && (
              <div className="confirmation-wrap">
                <div className="confirmation-header">
                  <span className="confirmation-icon">
                    <i className="ti ti-check"></i>
                  </span>
                  <span className="wizard-card__title-group">
                    <span className="wizard-card__title">Appointment confirmed</span>
                    <span className="confirmation-header__subtitle">
                      {selectedService?.name} · {selectedDoctor?.name} · {dateLabel} at {selectedSlot}
                    </span>
                  </span>
                </div>

                <div className="confirmation-badge-box">
                  <div className="summary-item__label">
                    Appointment Reference
                  </div>
                  <div className="confirmation-ref">{bookingRef}</div>
                </div>

                <p className="pms-info-card__desc">
                  Your appointment has been successfully confirmed and recorded for +91 {cleanMobile}.
                </p>

                <div>
                  <button
                    type="button"
                    onClick={handleRestart}
                    className="btn-secondary"
                  >
                    <i className="ti ti-plus"></i>Book another appointment
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Card Footer Navigation */}
          {step <= 4 && (
            <div className="wizard-footer">
              <div className="wizard-footer__btn-row">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="btn-back-footer"
                    aria-label="Previous step"
                    title="Go back"
                  >
                    <i className="ti ti-chevron-left"></i>
                  </button>
                )}

                <span className="wizard-footer__hint desktop-only">
                  {step === 1 ? (selectedService ? `${selectedService.duration}-minute consultation selected` : 'Select a department') :
                   step === 2 ? (selectedSlot ? `${dateLabel} at ${selectedSlot}` : 'Doctor, date and time required') :
                   step === 3 ? 'Fields marked * are required' :
                   'Confirms your appointment with the clinic'}
                </span>

                <button
                  type="button"
                  disabled={submitting || (step === 1 && services.length === 0)}
                  onClick={handleNext}
                  className="btn-primary"
                >
                  <span>{submitting ? 'Confirming...' : step === 4 ? 'Confirm & book' : 'Continue'}</span>
                  <i className={submitting ? 'ti ti-loader' : step === 4 ? 'ti ti-check' : 'ti ti-chevron-right'}></i>
                </button>
              </div>

              <div className="mobile-home-indicator"></div>
            </div>
          )}

        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="app-footer__inner">
          {hospitalInfo?.name && (
            <span>
              {hospitalInfo.name}
              {hospitalInfo.address ? ` · ${hospitalInfo.address}` : ''}
            </span>
          )}
          <span className="app-footer__right">
            Verified Clinic Booking Portal
          </span>
        </div>
      </footer>

      {/* Patient Full Record Detail Modal */}
      {detailPatient && (
        <PatientDetailModal
          patient={detailPatient}
          onClose={() => setDetailPatient(null)}
        />
      )}
    </div>
  )
}
