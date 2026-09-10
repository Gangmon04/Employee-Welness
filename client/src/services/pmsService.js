const CLOUD_CATALYST_URL = import.meta.env.VITE_CATALYST_URL || 'https://wellness-pms-60060142033.development.catalystserverless.in/server/pms_appointment_service';

// If on localhost (Vite dev or Catalyst serve), try relative /server first; else use Cloud URL (e.g. on Slate)
const PRIMARY_CATALYST_URL = (typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.includes('catalystserverless.in')
))
  ? '/server/pms_appointment_service'
  : CLOUD_CATALYST_URL;

const PMS_BASE_URL = 'https://pms.zohosolution.in/crm';

let cachedPmsToken = null;
let tokenExpiry = 0;

/**
 * Universal fetcher that tries local Catalyst endpoint first, then Cloud Catalyst endpoint.
 */
async function fetchCatalyst(path, options = {}) {
  // Try primary (local proxy or direct cloud)
  try {
    const res = await fetch(`${PRIMARY_CATALYST_URL}${path}`, options);
    if (res.ok) {
      const data = await res.json();
      if (data.ok) return data;
    }
  } catch (err) {
    console.warn(`Primary catalyst fetch failed for ${path}:`, err.message);
  }

  // Fallback to CLOUD_CATALYST_URL if primary was relative and failed
  if (PRIMARY_CATALYST_URL !== CLOUD_CATALYST_URL) {
    try {
      const cRes = await fetch(`${CLOUD_CATALYST_URL}${path}`, options);
      if (cRes.ok) {
        const data = await cRes.json();
        if (data.ok) return data;
      }
    } catch (cErr) {
      console.warn(`Fallback cloud catalyst fetch failed for ${path}:`, cErr.message);
    }
  }

  return null;
}

/**
 * Obtain valid PMS OAuth access token via Catalyst serverless bridge or direct Zoho Accounts.
 */
export async function getPmsAccessToken() {
  const now = Date.now();
  if (cachedPmsToken && now < tokenExpiry) {
    return cachedPmsToken;
  }

  // Attempt 1: Catalyst serverless token bridge
  try {
    const cRes = await fetch(`${CATALYST_BASE_URL}/token`);
    if (cRes.ok) {
      const cData = await cRes.json();
      if (cData.ok && cData.accessToken) {
        cachedPmsToken = cData.accessToken;
        tokenExpiry = now + ((cData.expiresIn || 3600) - 120) * 1000;
        return cachedPmsToken;
      }
    }
  } catch (e) {
    console.warn('Catalyst token bridge unreachable, trying direct auth:', e);
  }

  // Attempt 2: Direct Zoho Accounts client credentials grant
  try {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: '1000.M7UZ636I4HBLKE6KZNMMYV7CWLWYLK',
      client_secret: '0a79b82f62efb5700f6811a78381ec8e785f6b6f8c',
      scope: 'Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL',
      soid: 'Solution.60087134054'
    });

    const aRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
      method: 'POST',
      body: params
    });
    const aData = await aRes.json();
    if (aData.access_token) {
      cachedPmsToken = aData.access_token;
      tokenExpiry = now + ((aData.expires_in || 3600) - 120) * 1000;
      return cachedPmsToken;
    }
  } catch (err) {
    console.error('Direct Zoho Accounts auth error:', err);
  }

  throw new Error('Failed to obtain PMS access token through both Catalyst and Accounts.');
}

const FALLBACK_SERVICES = [
  { id: 'srv_gen_01', name: 'General Physician Consultation', duration: 20, description: 'Comprehensive primary clinical examination and care plan.', price: 500, status: 'Available', location: 'Main Clinic' },
  { id: 'srv_cardio_01', name: 'Cardiology Review', duration: 30, description: 'Cardiac risk assessment, blood pressure check, and consultation.', price: 800, status: 'Available', location: 'Main Clinic' },
  { id: 'srv_dent_01', name: 'Dental Checkup & Cleaning', duration: 30, description: 'Oral wellness, hygiene assessment, and dental inspection.', price: 600, status: 'Available', location: 'Dental Wing' },
  { id: 'srv_derma_01', name: 'Dermatology Consultation', duration: 20, description: 'Specialist skin, hair, and allergy consultation.', price: 700, status: 'Available', location: 'Main Clinic' },
  { id: 'srv_ortho_01', name: 'Orthopedics & Joint Care', duration: 30, description: 'Joint pain analysis, posture check, and mobility advice.', price: 750, status: 'Available', location: 'Main Clinic' },
  { id: 'srv_paed_01', name: 'Pediatric Health Check', duration: 25, description: 'Child growth tracking, vaccination review, and care.', price: 600, status: 'Available', location: 'Child Care Wing' }
];

const FALLBACK_DOCTORS = [
  { id: 'doc_01', name: 'Dr. Ganga Elumalai', email: 'ganga@sugah.co', role: 'Chief Medical Officer / Lead Physician' },
  { id: 'doc_02', name: 'Dr. Rajesh Kumar', email: 'rajesh.k@sugah.co', role: 'General Medicine Consultant' },
  { id: 'doc_03', name: 'Dr. Priya Sharma', email: 'priya.s@sugah.co', role: 'Cardiology Specialist' }
];

/**
 * Fetch active PMS doctors/practitioners from PMS users API.
 */
export async function getPmsDoctors() {
  const cData = await fetchCatalyst('/doctors');
  if (cData && Array.isArray(cData.doctors) && cData.doctors.length > 0) {
    return cData.doctors;
  }
  return FALLBACK_DOCTORS;
}

/**
 * Fetch live PMS Services from Services__s module in PMS.
 */
export async function getPmsServices() {
  const cData = await fetchCatalyst('/services');
  if (cData && Array.isArray(cData.services) && cData.services.length > 0) {
    return cData.services;
  }
  return FALLBACK_SERVICES;
}

export const getPmsDepartments = getPmsServices;



/**
 * Search Patient in PMS by 10-digit mobile number.
 */
export async function searchPmsPatient(mobileNumber) {
  const cleanMobile = String(mobileNumber).replace(/\D/g, '').slice(-10);
  if (!cleanMobile) return null;

  const cData = await fetchCatalyst(`/patient/search?mobile=${encodeURIComponent(cleanMobile)}`);
  if (cData && cData.found && cData.patient) {
    return cData.patient;
  }

  // Direct CRM API fallback
  try {
    const token = await getPmsAccessToken();
    const res = await fetch(`${PMS_BASE_URL}/v2/Patient/search?criteria=(Mobile_No:equals:${encodeURIComponent(cleanMobile)})`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    if (res.status === 200) {
      const data = await res.json();
      if (data.data?.[0]) {
        const p = data.data[0];
        return {
          id: p.id,
          name: p.Full_Name || `${p.First_Name || ''} ${p.Last_Name || ''}`.trim(),
          firstName: p.First_Name || '',
          lastName: p.Last_Name || '',
          mobile: p.Mobile_No || cleanMobile,
          email: p.Email || ''
        };
      }
    }
  } catch (e) {
    console.warn('Direct patient search error:', e);
  }

  return null;
}

/**
 * Fetch already booked slots for a specific date from Appointments__s.
 */
export async function getPmsBookedAppointments(dateStr) {
  if (!dateStr) return [];

  const cData = await fetchCatalyst(`/booked-slots?date=${encodeURIComponent(dateStr)}`);
  if (cData && Array.isArray(cData.booked)) {
    return cData.booked.map(r => {
      const d = new Date(r.startTime);
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const isPM = hours >= 12;
      const displayHours = hours % 12 === 0 ? 12 : hours % 12;
      return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    });
  }

  // Direct CRM API fallback
  try {
    const token = await getPmsAccessToken();
    const res = await fetch(`${PMS_BASE_URL}/v3/Appointments__s?fields=id,Appointment_Start_Time,Appointment_End_Time,Status&per_page=100`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    const data = await res.json();
    const records = data.data || [];
    return records
      .filter(r => !dateStr || (r.Appointment_Start_Time && r.Appointment_Start_Time.startsWith(dateStr)))
      .map(r => {
        const d = new Date(r.Appointment_Start_Time);
        const hours = d.getHours();
        const minutes = d.getMinutes();
        const isPM = hours >= 12;
        const displayHours = hours % 12 === 0 ? 12 : hours % 12;
        return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
      });
  } catch (e) {
    console.warn('Could not fetch booked appointments:', e);
    return [];
  }
}

/**
 * Fetch Priority picklist values dynamically from Appointments__s module metadata.
 */
export async function getPmsPriorities() {
  try {
    const token = await getPmsAccessToken();
    const res = await fetch(`${PMS_BASE_URL}/v3/settings/fields?module=Appointments__s`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    const data = await res.json();
    const priorityField = (data.fields || []).find(f => f.api_name === 'Priority');
    if (priorityField?.pick_list_values) {
      return priorityField.pick_list_values
        .filter(v => v.actual_value && v.actual_value !== '-None-')
        .map(v => v.actual_value);
    }
  } catch (err) {
    console.warn('Failed to load priority metadata, using standard fallback:', err);
  }
  return ['Routine', 'Urgent', 'ASAP', 'STAT'];
}

/**
 * Book a new appointment in Appointments__s module in PMS.
 */
export async function createPmsAppointment({
  firstName = '',
  lastName = '',
  patientName = '',
  mobileNumber = '',
  doctorId = '',
  doctor = null,
  departmentId = '',
  department = null,
  service = null,
  duration = 30,
  visitDate = '',
  startTime = '',
  priority = 'Routine',
  appointmentName = '',
  chiefComplaint = '',
  additionalInfo = ''
}) {
  const resolvedFullName = (patientName || `${firstName} ${lastName}`).trim();

  // 1. Try Catalyst endpoint
  const cData = await fetchCatalyst('/book-appointment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName,
      lastName,
      patientName: resolvedFullName,
      mobileNumber,
      doctor: doctor || (doctorId ? { id: doctorId } : null),
      department: department || (departmentId ? { id: departmentId } : null),
      service: service || department,
      duration,
      visitDate,
      startTime,
      priority,
      appointmentName,
      chiefComplaint: chiefComplaint || additionalInfo
    })
  });

  if (cData && cData.ok) {
    return cData;
  }

  // 2. Direct PMS CRM API fallback
  const token = await getPmsAccessToken();

  // Resolve or create Patient
  let patientId = null;
  const cleanMobile = String(mobileNumber).replace(/\D/g, '').slice(-10);
  if (cleanMobile) {
    const sRes = await fetch(`${PMS_BASE_URL}/v2/Patient/search?criteria=(Mobile_No:equals:${encodeURIComponent(cleanMobile)})`, {
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    if (sRes.status === 200) {
      const sData = await sRes.json();
      patientId = sData.data?.[0]?.id;
    }
  }

  if (!patientId) {
    const createPRes = await fetch(`${PMS_BASE_URL}/v2/Patient`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: [{
          Full_Name: resolvedFullName,
          First_Name: firstName || resolvedFullName.split(' ')[0] || '',
          Last_Name: lastName || resolvedFullName.split(' ').slice(1).join(' ') || '',
          Mobile_No: cleanMobile || mobileNumber || ''
        }]
      })
    });
    const createPData = await createPRes.json();
    patientId = createPData.data?.[0]?.details?.id;
  }

  const targetServiceId = service?.id || department?.id || departmentId;
  const targetServiceName = service?.name || department?.name || 'Consultation';
  const targetDuration = duration || 30;

  // Format start & end datetime strings for Zoho
  const timePart = startTime ? startTime.replace(/\s*(AM|PM)/i, '').trim() : '10:00';
  const isPM = startTime && startTime.toUpperCase().includes('PM');
  let [hrs, mins] = timePart.split(':').map(Number);
  if (isPM && hrs < 12) hrs += 12;
  if (!isPM && startTime && startTime.toUpperCase().includes('AM') && hrs === 12) hrs = 0;

  const pad = (n) => String(n).padStart(2, '0');
  const startDateTime = `${visitDate}T${pad(hrs || 10)}:${pad(mins || 0)}:00+05:30`;
  const endDate = new Date(new Date(startDateTime).getTime() + (Number(targetDuration) || 30) * 60 * 1000);
  const endDateTime = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00+05:30`;

  const record = {
    Appointment_Name: appointmentName?.trim() || `${targetServiceName} - ${resolvedFullName}`,
    Appointment_For: {
      id: String(patientId),
      module: { api_name: 'Patient' }
    },
    Location: 'Business Address',
    Appointment_Start_Time: startDateTime,
    Appointment_End_Time: endDateTime,
    Status: 'Scheduled',
    Priority: priority || 'Routine',
    Chief_Complaint: chiefComplaint || 'Consultation'
  };

  if (targetServiceId) {
    record.Service_Name = { id: String(targetServiceId) };
  }

  const targetDocId = doctor?.id || doctorId;
  if (targetDocId) {
    record.Owner = { id: String(targetDocId) };
  }

  const insertRes = await fetch(`${PMS_BASE_URL}/v3/Appointments__s`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: [record] })
  });

  const insertData = await insertRes.json();
  const resObj = insertData.data?.[0];
  if (resObj?.code === 'SUCCESS') {
    return {
      ok: true,
      appointmentId: resObj.details?.id,
      appointmentName: record.Appointment_Name,
      patientId
    };
  }

  throw new Error(resObj?.message || insertData.message || 'Failed to create appointment in PMS.');
}
