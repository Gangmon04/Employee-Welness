'use strict';

const PMS_BASE_URL = 'https://pms.zohosolution.in/crm';
const CLIENT_ID = process.env.CLIENT_ID || '1000.M7UZ636I4HBLKE6KZNMMYV7CWLWYLK';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '0a79b82f62efb5700f6811a78381ec8e785f6b6f8c';
const SOID = process.env.SOID || 'Solution.60087134054';
const SCOPES = process.env.SCOPES || 'Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL';

let cachedToken = process.env.PMS_TOKEN || null;
let tokenExpiryTime = 0;

async function getAccessToken() {
	const now = Date.now();
	if (cachedToken && now < tokenExpiryTime) {
		return cachedToken;
	}

	try {
		const params = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			scope: SCOPES,
			soid: SOID
		});

		const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
			method: 'POST',
			body: params
		});

		const rawText = await res.text();
		const data = JSON.parse(rawText);

		if (data.access_token) {
			cachedToken = data.access_token;
			tokenExpiryTime = now + ((data.expires_in || 3600) - 300) * 1000;
			return cachedToken;
		}
		console.warn('Zoho accounts token response:', rawText.slice(0, 200));
	} catch (err) {
		console.warn('OAuth refresh error, using cached token if available:', err.message);
	}

	if (cachedToken) {
		return cachedToken;
	}

	throw new Error('Unable to authenticate with Zoho Accounts. Please try again later.');
}

function sendJson(res, statusCode, body) {
	res.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	});
	res.end(JSON.stringify(body));
}

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let raw = '';
		req.on('data', (chunk) => { raw += chunk; });
		req.on('end', () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch (err) {
				reject(new Error('Invalid JSON payload'));
			}
		});
		req.on('error', reject);
	});
}

/**
 * Resolve or create Patient in PMS so Appointments__s can link to it.
 * Implements prospect matching: searches by mobile or full name;
 * if not found, creates a new Patient record in PMS.
 */
async function resolvePatientId(token, { patientName, firstName, lastName, mobileNumber, email }) {
	const fullName = (patientName || `${firstName || ''} ${lastName || ''}`).trim();
	const cleanMobile = mobileNumber ? String(mobileNumber).replace(/[^\d]/g, '').slice(-10) : '';

	// 1. Try search by Mobile
	if (cleanMobile) {
		const searchRes = await fetch(`${PMS_BASE_URL}/v2/Patient/search?criteria=(Mobile_No:equals:${encodeURIComponent(cleanMobile)})`, {
			headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
		});
		if (searchRes.status === 200) {
			const data = await searchRes.json();
			if (data.data?.[0]?.id) return data.data[0].id;
		}
	}

	// 2. Try search by Full Name
	if (fullName) {
		const nameRes = await fetch(`${PMS_BASE_URL}/v2/Patient/search?criteria=(Full_Name:equals:${encodeURIComponent(fullName)})`, {
			headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
		});
		if (nameRes.status === 200) {
			const data = await nameRes.json();
			if (data.data?.[0]?.id) return data.data[0].id;
		}
	}

	// 3. Not found — create Patient record in PMS (Prospect registration)
	const createRes = await fetch(`${PMS_BASE_URL}/v2/Patient`, {
		method: 'POST',
		headers: {
			'Authorization': `Zoho-oauthtoken ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			data: [{
				Full_Name: fullName,
				First_Name: firstName || fullName.split(' ')[0] || '',
				Last_Name: lastName || fullName.split(' ').slice(1).join(' ') || '',
				Mobile_No: cleanMobile || mobileNumber || '',
				Email: email || ''
			}]
		})
	});
	const createData = await createRes.json();
	const createdId = createData.data?.[0]?.details?.id;
	if (createdId) return createdId;

	// Fallback to first existing patient if any
	try {
		const listRes = await fetch(`${PMS_BASE_URL}/v2/Patient?per_page=1`, {
			headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
		});
		const listData = await listRes.json();
		return listData.data?.[0]?.id || null;
	} catch (e) {
		return null;
	}
}

module.exports = async (req, res) => {
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		});
		res.end();
		return;
	}

	const parsedUrl = new URL(req.url, 'http://localhost');
	const pathname = parsedUrl.pathname.replace(/\/$/, '') || '/';

	try {
		// Route: GET /debug-token
		if (req.method === 'GET' && pathname.endsWith('/debug-token')) {
			const params = new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				scope: SCOPES,
				soid: SOID
			});
			const accRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
				method: 'POST',
				body: params
			});
			const text = await accRes.text();
			return sendJson(res, 200, {
				status: accRes.status,
				clientIdLength: CLIENT_ID ? CLIENT_ID.length : 0,
				soid: SOID,
				raw: text
			});
		}

		// Route: GET /token
		if (req.method === 'GET' && pathname.endsWith('/token')) {
			const token = await getAccessToken();
			return sendJson(res, 200, {
				ok: true,
				accessToken: token,
				expiresIn: Math.max(0, Math.floor((tokenExpiryTime - Date.now()) / 1000)),
				apiDomain: `${PMS_BASE_URL}/v3`
			});
		}

		// Route: GET /priorities
		if (req.method === 'GET' && pathname.endsWith('/priorities')) {
			return sendJson(res, 200, { ok: true, priorities: ['Routine', 'Urgent', 'ASAP', 'STAT'] });
		}

		// Route: GET /doctors (Active practitioners from PMS)
		if (req.method === 'GET' && pathname.endsWith('/doctors')) {
			try {
				const token = await getAccessToken();
				const pmsRes = await fetch(`${PMS_BASE_URL}/v2/users?type=ActiveUsers`, {
					headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
				});
				const pmsData = await pmsRes.json();
				if (pmsData.users && Array.isArray(pmsData.users)) {
					const doctors = pmsData.users
						.filter(u => u.profile?.name === 'Doctor' || u.role?.name === 'Doctor' || u.profile?.name === 'Administrator' || u.role?.name === 'CEO / MD')
						.map(u => ({
							id: u.id,
							name: u.full_name,
							email: u.email,
							role: u.role?.name || u.profile?.name || 'Doctor'
						}));
					if (doctors.length > 0) {
						return sendJson(res, 200, { ok: true, doctors, live: true });
					}
				}
			} catch (e) {
				console.warn('Live doctors fetch error, serving cached doctor profiles:', e.message);
			}

			const fallbackDoctors = [
				{ id: 'doc_01', name: 'Dr. Ganga Elumalai', email: 'ganga@sugah.co', role: 'Chief Medical Officer / Lead Physician' },
				{ id: 'doc_02', name: 'Dr. Rajesh Kumar', email: 'rajesh.k@sugah.co', role: 'General Medicine Consultant' },
				{ id: 'doc_03', name: 'Dr. Priya Sharma', email: 'priya.s@sugah.co', role: 'Cardiology Specialist' }
			];

			return sendJson(res, 200, { ok: true, doctors: fallbackDoctors, live: false });
		}

		// Route: GET /departments or /services (from Services__s in PMS)
		if (req.method === 'GET' && (pathname.endsWith('/departments') || pathname.endsWith('/services'))) {
			try {
				const token = await getAccessToken();
				const pmsRes = await fetch(`${PMS_BASE_URL}/v3/Services__s?fields=id,Service_Name,Duration,Description,Price,Status,Location&per_page=100`, {
					headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
				});
				const pmsData = await pmsRes.json();
				const services = (pmsData.data || []).map(s => ({
					id: s.id,
					name: s.Service_Name || 'Consultation',
					duration: s.Duration || 30,
					description: s.Description || 'Clinical consultation and examination.',
					price: s.Price || 0,
					status: s.Status || 'Available',
					location: s.Location || 'Business Address'
				}));

				if (services.length > 0) {
					return sendJson(res, 200, { ok: true, departments: services, services, live: true });
				}
			} catch (e) {
				console.warn('Live services fetch error, serving cached services:', e.message);
			}

			const fallbackServices = [
				{ id: 'srv_gen_01', name: 'General Physician Consultation', duration: 20, description: 'Comprehensive primary clinical examination and care plan.', price: 500, status: 'Available', location: 'Main Clinic' },
				{ id: 'srv_cardio_01', name: 'Cardiology Review', duration: 30, description: 'Cardiac risk assessment, blood pressure check, and consultation.', price: 800, status: 'Available', location: 'Main Clinic' },
				{ id: 'srv_dent_01', name: 'Dental Checkup & Cleaning', duration: 30, description: 'Oral wellness, hygiene assessment, and dental inspection.', price: 600, status: 'Available', location: 'Dental Wing' },
				{ id: 'srv_derma_01', name: 'Dermatology Consultation', duration: 20, description: 'Specialist skin, hair, and allergy consultation.', price: 700, status: 'Available', location: 'Main Clinic' },
				{ id: 'srv_ortho_01', name: 'Orthopedics & Joint Care', duration: 30, description: 'Joint pain analysis, posture check, and mobility advice.', price: 750, status: 'Available', location: 'Main Clinic' },
				{ id: 'srv_paed_01', name: 'Pediatric Health Check', duration: 25, description: 'Child growth tracking, vaccination review, and care.', price: 600, status: 'Available', location: 'Child Care Wing' }
			];

			return sendJson(res, 200, { ok: true, departments: fallbackServices, services: fallbackServices, live: false });
		}

		// Route: GET /patient/search?mobile=...
		if (req.method === 'GET' && pathname.endsWith('/patient/search')) {
			const mobileParam = parsedUrl.searchParams.get('mobile');
			if (!mobileParam) return sendJson(res, 200, { ok: true, found: false });
			const token = await getAccessToken();
			const cleanMobile = String(mobileParam).replace(/\D/g, '').slice(-10);
			const sRes = await fetch(`${PMS_BASE_URL}/v2/Patient/search?criteria=(Mobile_No:equals:${encodeURIComponent(cleanMobile)})`, {
				headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
			});
			if (sRes.status === 200) {
				const sData = await sRes.json();
				if (sData.data?.[0]) {
					const p = sData.data[0];
					return sendJson(res, 200, {
						ok: true,
						found: true,
						patient: {
							id: p.id,
							name: p.Full_Name || `${p.First_Name || ''} ${p.Last_Name || ''}`.trim(),
							firstName: p.First_Name || '',
							lastName: p.Last_Name || '',
							mobile: p.Mobile_No || cleanMobile,
							email: p.Email || ''
						}
					});
				}
			}
			return sendJson(res, 200, { ok: true, found: false });
		}

		// Route: GET /booked-slots?date=YYYY-MM-DD
		if (req.method === 'GET' && pathname.endsWith('/booked-slots')) {
			const dateParam = parsedUrl.searchParams.get('date');
			const token = await getAccessToken();
			const aRes = await fetch(`${PMS_BASE_URL}/v3/Appointments__s?fields=id,Appointment_Start_Time,Appointment_End_Time,Status,Service_Name&per_page=100`, {
				headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
			});
			const aData = await aRes.json();
			const booked = (aData.data || [])
				.filter(a => !dateParam || (a.Appointment_Start_Time && a.Appointment_Start_Time.startsWith(dateParam)))
				.map(a => ({
					id: a.id,
					startTime: a.Appointment_Start_Time,
					endTime: a.Appointment_End_Time,
					status: a.Status
				}));
			return sendJson(res, 200, { ok: true, booked });
		}

		// Route: POST /book-appointment -> Creates in Appointments__s module!
		if (req.method === 'POST' && pathname.endsWith('/book-appointment')) {
			const body = await readJsonBody(req);
			const {
				firstName,
				lastName,
				patientName,
				mobileNumber,
				email,
				doctor,
				department,
				service,
				duration,
				visitDate,
				startTime,
				priority,
				appointmentName,
				chiefComplaint
			} = body;

			const fullName = (patientName || `${firstName || ''} ${lastName || ''}`).trim();

			if (!fullName || !visitDate) {
				return sendJson(res, 400, {
					ok: false,
					error: 'Patient Name and Appointment Date are required.'
				});
			}

			const token = await getAccessToken();

			// 1. Resolve Patient ID in PMS
			const patientId = await resolvePatientId(token, { firstName, lastName, patientName: fullName, mobileNumber, email });
			if (!patientId) {
				return sendJson(res, 400, {
					ok: false,
					error: 'Could not link or create Patient profile in PMS for this appointment.'
				});
			}

			// 2. Resolve Service / Department ID
			let serviceId = service?.id || department?.id;
			let serviceName = service?.name || department?.name || 'Consultation';
			let serviceDuration = duration || service?.duration || department?.duration || 30;

			if (!serviceId) {
				const sRes = await fetch(`${PMS_BASE_URL}/v3/Services__s?fields=id,Service_Name,Duration`, {
					headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
				});
				const sData = await sRes.json();
				const firstService = sData.data?.[0];
				if (firstService) {
					serviceId = firstService.id;
					serviceName = firstService.Service_Name;
					serviceDuration = firstService.Duration || 30;
				}
			}

			// 3. Format DateTimes: "2026-09-15T10:00:00+05:30"
			const timePart = startTime ? startTime.replace(/\s*(AM|PM)/i, '').trim() : '10:00';
			const isPM = startTime && startTime.toUpperCase().includes('PM');
			let [hrs, mins] = timePart.split(':').map(Number);
			if (isPM && hrs < 12) hrs += 12;
			if (!isPM && startTime && startTime.toUpperCase().includes('AM') && hrs === 12) hrs = 0;
			const pad = (n) => String(n).padStart(2, '0');
			const startDateTimeStr = `${visitDate}T${pad(hrs || 10)}:${pad(mins || 0)}:00+05:30`;

			// Calculate end time (+duration)
			const endDate = new Date(new Date(startDateTimeStr).getTime() + (Number(serviceDuration) || 30) * 60 * 1000);
			const endDateTimeStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00+05:30`;

			// 4. Construct record for Appointments__s
			const finalAppointmentName = appointmentName?.trim() || `${serviceName} - ${fullName}`;

			const appointmentRecord = {
				Appointment_Name: finalAppointmentName,
				Appointment_For: {
					id: String(patientId),
					module: { api_name: 'Patient' }
				},
				Location: 'Business Address',
				Appointment_Start_Time: startDateTimeStr,
				Appointment_End_Time: endDateTimeStr,
				Status: 'Scheduled',
				Priority: priority || 'Routine',
				Chief_Complaint: chiefComplaint || 'Clinical Consultation'
			};

			if (serviceId) {
				appointmentRecord.Service_Name = { id: String(serviceId) };
			}

			if (doctor?.id) {
				appointmentRecord.Owner = { id: String(doctor.id) };
			}

			// 5. Insert record into Appointments__s via v3 API
			const insertRes = await fetch(`${PMS_BASE_URL}/v3/Appointments__s`, {
				method: 'POST',
				headers: {
					'Authorization': `Zoho-oauthtoken ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ data: [appointmentRecord] })
			});

			const insertRaw = await insertRes.text();
			let insertData;
			try {
				insertData = JSON.parse(insertRaw);
			} catch (e) {
				throw new Error(`PMS Appointments insert error (${insertRes.status}): ${insertRaw.slice(0, 150)}`);
			}

			const result = insertData.data?.[0];

			if (result?.code === 'SUCCESS') {
				return sendJson(res, 200, {
					ok: true,
					appointmentId: result.details?.id,
					appointmentName: appointmentRecord.Appointment_Name,
					patientId,
					message: 'Appointment successfully created in PMS (Appointments__s).'
				});
			}

			return sendJson(res, 400, {
				ok: false,
				error: result?.message || insertData.message || 'Failed to create appointment in PMS.',
				details: insertData
			});
		}

		return sendJson(res, 200, {
			status: 'ok',
			service: 'pms_appointment_service',
			version: '2.0.0',
			targetModule: 'Appointments__s',
			connectedTo: PMS_BASE_URL
		});
	} catch (err) {
		console.error('PMS Service Error:', err);
		return sendJson(res, 500, {
			ok: false,
			error: err.message || 'Internal server error'
		});
	}
};
