'use strict';

const { zrc, getAccessToken, PMS_BASE_URL, CLIENT_ID, SOID } = require('./zrc');

let cachedOrgLogo = null;
let logoCachedAt = 0;
const doctorImageCache = new Map();
const doctorZuidCache = new Map();

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
 * Resolves the polymorphic Appointment_For target using ZRC / COQL:
 * 1. If matchedPatientId is provided or an existing Patient is found via COQL:
 *    { id: patientId, module: { api_name: 'Patient' }, isProspect: false }
 * 2. If NO existing Patient exists in PMS (Prospect Appointment):
 *    Reuses or creates a lightweight prospect Contact in the `Contacts` module via ZRC:
 *    { id: contactId, module: { api_name: 'Contacts' }, isProspect: true }
 */
async function resolveAppointmentFor({ patientName, firstName, lastName, mobileNumber, email, matchedPatientId }) {
	const fullName = (patientName || `${firstName || ''} ${lastName || ''}`).trim();
	const cleanMobile = mobileNumber ? String(mobileNumber).replace(/[^\d]/g, '').slice(-10) : '';

	// 1. If explicitly matched to an existing Patient
	if (matchedPatientId) {
		return {
			id: String(matchedPatientId),
			module: { api_name: 'Patient' },
			isProspect: false
		};
	}

	// 2. Search Patient module using COQL
	if (cleanMobile) {
		try {
			const pCoql = await zrc.coql(`select id, Full_Name, Mobile_No from Patient where Mobile_No = '${cleanMobile}'`);
			if (pCoql.ok && pCoql.data?.data?.[0]?.id) {
				return {
					id: String(pCoql.data.data[0].id),
					module: { api_name: 'Patient' },
					isProspect: false
				};
			}
		} catch (err) {
			console.warn('ZRC Patient COQL search error, falling back to criteria search:', err.message);
			try {
				const pRes = await zrc.get('/crm/v8/Patient/search', {
					params: { criteria: `(Mobile_No:equals:${cleanMobile})` }
				});
				if (pRes.ok && pRes.data?.data?.[0]?.id) {
					return {
						id: String(pRes.data.data[0].id),
						module: { api_name: 'Patient' },
						isProspect: false
					};
				}
			} catch (fallbackErr) {
				console.warn('Patient fallback search error:', fallbackErr.message);
			}
		}
	}

	// 3. No existing Patient found -> Search Contacts module via COQL to reuse existing contact
	if (cleanMobile) {
		try {
			const cCoql = await zrc.coql(`select id, Full_Name, Phone, Mobile from Contacts where Phone = '${cleanMobile}' or Mobile = '${cleanMobile}'`);
			if (cCoql.ok && cCoql.data?.data?.[0]?.id) {
				return {
					id: String(cCoql.data.data[0].id),
					module: { api_name: 'Contacts' },
					isProspect: true
				};
			}
		} catch (err) {
			console.warn('ZRC Contacts COQL error, falling back to search API:', err.message);
			try {
				const cRes = await zrc.get('/crm/v8/Contacts/search', {
					params: { phone: cleanMobile }
				});
				if (cRes.ok && cRes.data?.data?.[0]?.id) {
					return {
						id: String(cRes.data.data[0].id),
						module: { api_name: 'Contacts' },
						isProspect: true
					};
				}
			} catch (cErr) {
				console.warn('Contacts fallback search error:', cErr.message);
			}
		}
	}

	// 4. Create new lightweight prospect Contact in Contacts module using ZRC POST
	const fName = firstName || fullName.split(' ')[0] || '';
	const lName = lastName || fullName.split(' ').slice(1).join(' ') || fName || 'Prospect';
	const indiaMobile = cleanMobile ? `+91${cleanMobile}` : (mobileNumber || '');

	const newContactRes = await zrc.post('/crm/v8/Contacts', {
		data: [{
			First_Name: fName,
			Last_Name: lName,
			Mobile: indiaMobile,
			Phone: indiaMobile,
			...(email ? { Email: email } : {}),
			Lead_Source: 'Online Appointment Booking'
		}],
		trigger: ['workflow']
	});

	const createdContactId = newContactRes.data?.data?.[0]?.details?.id;
	if (createdContactId) {
		return {
			id: String(createdContactId),
			module: { api_name: 'Contacts' },
			isProspect: true
		};
	}

	throw new Error(`Could not register prospect Contact in PMS: ${newContactRes.data?.data?.[0]?.message || 'Unknown error'}`);
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
		// Route: GET /hospital/logo or /clinic-logo or /org/photo (Raw Image Streaming)
		if (req.method === 'GET' && (pathname.endsWith('/hospital/logo') || pathname.endsWith('/clinic-logo') || pathname.endsWith('/org/photo'))) {
			try {
				const pRes = await zrc.getRaw('/crm/v8/org/photo');
				if (pRes.ok) {
					const contentType = (pRes.headers.get('content-type') || 'image/png').split(';')[0];
					const arrayBuf = await pRes.arrayBuffer();
					res.writeHead(200, {
						'Content-Type': contentType,
						'Content-Length': arrayBuf.byteLength,
						'Cache-Control': 'public, max-age=86400',
						'Access-Control-Allow-Origin': '*'
					});
					return res.end(Buffer.from(arrayBuf));
				}
				return sendJson(res, 404, { ok: false, error: 'No hospital logo found' });
			} catch (err) {
				return sendJson(res, 500, { ok: false, error: err.message });
			}
		}

		// Route: GET /hospital or /clinic-info or /hospital-info (Dynamic Hospital/Org name and logo from PMS via ZRC)
		if (req.method === 'GET' && (pathname.endsWith('/hospital') || pathname.endsWith('/clinic-info') || pathname.endsWith('/hospital-info') || pathname.endsWith('/org'))) {
			try {
				let hospitalName = '';
				let phone = '';
				let email = '';
				let address = '';
				let practiceType = '';
				let businessHours = '';

				// 1. Try App_Settings first via ZRC GET
				try {
					const sRes = await zrc.get('/crm/v8/App_Settings', {
						params: {
							fields: 'id,Hospital_Name,Contact_Number,Email_ID,Practice_Type,Address,City,State,Pincode',
							per_page: 1
						}
					});
					const setting = sRes.data?.data?.[0];
					if (setting) {
						hospitalName = setting.Hospital_Name || '';
						phone = setting.Contact_Number || '';
						email = setting.Email_ID || '';
						address = [setting.Address, setting.City, setting.State, setting.Pincode].filter(Boolean).join(', ');
						practiceType = setting.Practice_Type || '';
					}
				} catch (e) {
					console.warn('Could not fetch App_Settings via ZRC:', e.message);
				}

				// 2. Fallback to /crm/v8/org if hospitalName is not set in App_Settings
				if (!hospitalName) {
					try {
						const oRes = await zrc.get('/crm/v8/org');
						const org = oRes.data?.org?.[0];
						if (org) {
							hospitalName = org.company_name || '';
							phone = phone || org.phone || '';
							email = email || org.primary_email || '';
							address = address || [org.street, org.city, org.state, org.zip].filter(Boolean).join(', ');
						}
					} catch (oErr) {
						console.warn('Could not fetch org info via ZRC:', oErr.message);
					}
				}

				// 3. Fetch Business Hours for practice info via ZRC GET
				try {
					const bhRes = await zrc.get('/crm/v8/settings/business_hours');
					const bh = bhRes.data?.business_hours || (Array.isArray(bhRes.data?.data) ? bhRes.data.data[0] : null);
					if (bh?.business_days && Array.isArray(bh.business_days)) {
						businessHours = bh.business_days.join(', ');
					}
				} catch (bErr) {
					console.warn('Could not fetch business hours via ZRC:', bErr.message);
				}

				// 4. Fetch Hospital Logo Photo (cached in-memory for 1 hour)
				let hospitalImage = '';
				const now = Date.now();
				if (cachedOrgLogo && (now - logoCachedAt < 3600000)) {
					hospitalImage = cachedOrgLogo;
				} else {
					try {
						const pRes = await zrc.getRaw('/crm/v8/org/photo');
						if (pRes.ok) {
							const contentType = pRes.headers.get('content-type') || 'image/png';
							const arrayBuf = await pRes.arrayBuffer();
							if (arrayBuf.byteLength > 0) {
								const b64 = Buffer.from(arrayBuf).toString('base64');
								hospitalImage = `data:${contentType};base64,${b64}`;
								cachedOrgLogo = hospitalImage;
								logoCachedAt = Date.now();
							}
						}
					} catch (imgErr) {
						console.warn('Could not fetch hospital logo photo:', imgErr.message);
					}
				}

				return sendJson(res, 200, {
					ok: true,
					hospital: {
						name: hospitalName || '',
						phone: phone || '',
						email: email || '',
						address: address || '',
						practiceType: practiceType || '',
						businessHours: businessHours || '',
						image: hospitalImage || ''
					}
				});
			} catch (err) {
				console.error('Error fetching hospital info:', err);
				return sendJson(res, 500, { ok: false, error: err.message });
			}
		}

		// Route: GET /priorities
		if (req.method === 'GET' && pathname.endsWith('/priorities')) {
			return sendJson(res, 200, { ok: true, priorities: ['Routine', 'Urgent', 'ASAP', 'STAT'] });
		}

		// Route: GET /doctor-image (Fetches doctor photo from Zoho Contacts / CRM and streams image binary)
		if (req.method === 'GET' && pathname.endsWith('/doctor-image')) {
			try {
				const id = parsedUrl.searchParams.get('id');
				const zuid = parsedUrl.searchParams.get('zuid');
				if (!id && !zuid) {
					res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
					return res.end('Missing doctor id or zuid');
				}

				const cacheKey = String(id || zuid);
				const cached = doctorImageCache.get(cacheKey);
				if (cached && (Date.now() - cached.time < 30 * 60 * 1000)) {
					res.writeHead(200, {
						'Content-Type': cached.contentType,
						'Content-Length': cached.buffer.length,
						'Cache-Control': 'public, max-age=86400',
						'Access-Control-Allow-Origin': '*'
					});
					return res.end(cached.buffer);
				}

				let targetZuid = zuid || doctorZuidCache.get(String(id)) || null;

				// If no zuid known yet, lookup user's zuid from CRM via ZRC GET
				if (!targetZuid && id) {
					try {
						const uRes = await zrc.get(`/crm/v8/users/${id}`);
						const userZuid = uRes.data?.users?.[0]?.zuid;
						if (userZuid) {
							targetZuid = String(userZuid);
							doctorZuidCache.set(String(id), targetZuid);
						}
					} catch (uErr) {
						console.warn('Could not lookup user zuid:', uErr.message);
					}
				}

				let imgRes = null;

				// 1. Try contacts.zoho.in with OAuth token
				if (targetZuid) {
					try {
						imgRes = await zrc.getRaw(`https://contacts.zoho.in/file?ID=${targetZuid}&fs=thumb`);
					} catch (cErr) {
						console.warn('Contacts fetch error:', cErr.message);
					}
				}

				// 2. Try contacts.zoho.in without OAuth token as well
				if ((!imgRes || !imgRes.ok) && targetZuid) {
					try {
						imgRes = await fetch(`https://contacts.zoho.in/file?ID=${targetZuid}&fs=thumb`);
					} catch (cErr) {}
				}

				// 3. Try CRM user photo endpoint via ZRC raw
				if ((!imgRes || !imgRes.ok) && id) {
					try {
						imgRes = await zrc.getRaw(`/crm/v8/users/${id}/photo`);
					} catch (pErr) {
						console.warn('CRM photo fetch error:', pErr.message);
					}
				}

				if (imgRes && imgRes.ok) {
					const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
					const arrayBuf = await imgRes.arrayBuffer();
					const buffer = Buffer.from(arrayBuf);

					if (buffer.length > 0) {
						doctorImageCache.set(cacheKey, {
							buffer,
							contentType,
							time: Date.now()
						});

						res.writeHead(200, {
							'Content-Type': contentType,
							'Content-Length': buffer.length,
							'Cache-Control': 'public, max-age=86400',
							'Access-Control-Allow-Origin': '*'
						});
						return res.end(buffer);
					}
				}

				res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
				return res.end('Image not found');
			} catch (err) {
				console.error('Error in /doctor-image route:', err.message);
				res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
				return res.end('Internal server error');
			}
		}

		// Route: GET /doctors (Active practitioners from PMS via ZRC GET)
		if (req.method === 'GET' && pathname.endsWith('/doctors')) {
			try {
				const pmsRes = await zrc.get('/crm/v8/users', {
					params: {
						type: 'ActiveUsers',
						fields: 'id,full_name,first_name,last_name,email,Current_Shift__s,Department,Medical_Degrees,Specialization,image_link,Availability_Status,Availability_Start,Availability_End,Session_Slots,zuid,profile,role'
					}
				});
				const users = pmsRes.data?.users || [];
				const doctors = users
					.filter(u => u.profile?.name === 'Doctor' || u.role?.name === 'Doctor' || u.profile?.name === 'Administrator' || u.role?.name === 'CEO / MD')
					.map(u => {
						const zuid = u.zuid || null;
						if (u.id && zuid) {
							doctorZuidCache.set(String(u.id), String(zuid));
						}
						const image = `/server/pms_appointment_service/doctor-image?id=${u.id}${zuid ? `&zuid=${zuid}` : ''}`;
						const medicalDegrees = u.Medical_Degrees || u.medical_degrees || u.qualification || '';
						return {
							id: u.id,
							name: u.full_name,
							email: u.email,
							role: u.role?.name || u.profile?.name || 'Doctor',
							medicalDegrees: medicalDegrees || '',
							department: u.Department || '',
							specialization: u.Specialization || '',
							zuid,
							image
						};
					});
				return sendJson(res, 200, { ok: true, doctors });
			} catch (e) {
				console.error('Live doctors fetch error:', e.message);
				return sendJson(res, 500, { ok: false, error: e.message, doctors: [] });
			}
		}

		// Route: GET /departments or /services (from Services__s in PMS via ZRC COQL + GET fallback)
		if (req.method === 'GET' && (pathname.endsWith('/departments') || pathname.endsWith('/services'))) {
			try {
				let services = [];

				// Attempt 1: Fast single-query COQL for Services__s with Members
				try {
					const coqlRes = await zrc.coql("select id, Service_Name, Duration, Description, Price, Status, Location, Members from Services__s where Status = 'Active'");
					if (coqlRes.ok && Array.isArray(coqlRes.data?.data) && coqlRes.data.data.length > 0) {
						services = coqlRes.data.data.map(s => {
							const members = Array.isArray(s.Members)
								? s.Members.map(m => ({ id: m.Members?.id || m.id, name: m.Members?.name || '' })).filter(m => m.id)
								: [];
							return {
								id: s.id,
								name: s.Service_Name || 'Consultation',
								duration: Number(s.Duration) || 30,
								description: s.Description || '',
								price: s.Price || 0,
								status: s.Status || 'Available',
								location: s.Location || 'Business Address',
								members,
								doctorCount: members.length
							};
						});
					}
				} catch (coqlErr) {
					console.warn('Services COQL failed, using ZRC GET fallback:', coqlErr.message);
				}

				// Attempt 2: Standard ZRC GET fallback if COQL was unsupported or empty
				if (services.length === 0) {
					const pmsRes = await zrc.get('/crm/v8/Services__s', {
						params: {
							fields: 'id,Service_Name,Duration,Description,Price,Status,Location',
							per_page: 100
						}
					});
					const rawList = pmsRes.data?.data || [];
					services = await Promise.all(rawList.map(async s => {
						let members = [];
						try {
							const dRes = await zrc.get(`/crm/v8/Services__s/${s.id}`);
							const item = dRes.data?.data?.[0];
							if (item && Array.isArray(item.Members)) {
								members = item.Members.map(m => ({
									id: m.Members?.id || m.id,
									name: m.Members?.name || ''
								})).filter(m => m.id);
							}
						} catch (mErr) {
							console.warn('Could not fetch Members for service', s.id, mErr.message);
						}

						return {
							id: s.id,
							name: s.Service_Name || 'Consultation',
							duration: Number(s.Duration) || 30,
							description: s.Description || '',
							price: s.Price || 0,
							status: s.Status || 'Available',
							location: s.Location || 'Business Address',
							members,
							doctorCount: members.length
						};
					}));
				}

				return sendJson(res, 200, { ok: true, departments: services, services });
			} catch (e) {
				console.error('Live services fetch error:', e.message);
				return sendJson(res, 500, { ok: false, error: e.message, services: [] });
			}
		}

		// Route: GET /patient/search?mobile=... (using ZRC COQL)
		if (req.method === 'GET' && pathname.endsWith('/patient/search')) {
			const mobileParam = parsedUrl.searchParams.get('mobile');
			if (!mobileParam) return sendJson(res, 200, { ok: true, found: false });
			const cleanMobile = String(mobileParam).replace(/\D/g, '').slice(-10);

			try {
				// COQL query for targeted patient retrieval
				const coqlRes = await zrc.coql(
					`select id, Name, Full_Name, First_Name, Last_Name, Mobile_No, Email, Age1, Gender, UHID, Blood_Group, Date_of_Birth, Address_Line_1, City, State from Patient where Mobile_No = '${cleanMobile}'`
				);

				if (coqlRes.ok && coqlRes.data?.data?.[0]) {
					const p = coqlRes.data.data[0];
					return sendJson(res, 200, {
						ok: true,
						found: true,
						patient: {
							id: p.id,
							name: p.Full_Name || `${p.First_Name || ''} ${p.Last_Name || ''}`.trim() || p.Name || '',
							firstName: p.First_Name || '',
							lastName: p.Last_Name || '',
							mobile: p.Mobile_No || cleanMobile,
							email: p.Email || '',
							age: p.Age1 || p.Age || null,
							gender: p.Gender || null,
							uhid: p.UHID || null,
							bloodGroup: p.Blood_Group || null,
							dateOfBirth: p.Date_of_Birth || null,
							address: [p.Address_Line_1, p.City, p.State].filter(Boolean).join(', ') || null
						}
					});
				}

				// Fallback to standard ZRC criteria search if COQL returns no rows
				const sRes = await zrc.get('/crm/v8/Patient/search', {
					params: { criteria: `(Mobile_No:equals:${cleanMobile})` }
				});
				if (sRes.ok && sRes.data?.data?.[0]) {
					const p = sRes.data.data[0];
					return sendJson(res, 200, {
						ok: true,
						found: true,
						patient: {
							id: p.id,
							name: p.Full_Name || `${p.First_Name || ''} ${p.Last_Name || ''}`.trim() || p.Name || '',
							firstName: p.First_Name || '',
							lastName: p.Last_Name || '',
							mobile: p.Mobile_No || cleanMobile,
							email: p.Email || '',
							age: p.Age1 || p.Age || null,
							gender: p.Gender || null,
							uhid: p.UHID || null,
							bloodGroup: p.Blood_Group || null,
							dateOfBirth: p.Date_of_Birth || null,
							address: [p.Address_Line_1, p.City, p.State].filter(Boolean).join(', ') || null
						}
					});
				}

				return sendJson(res, 200, { ok: true, found: false });
			} catch (err) {
				console.error('Patient search error:', err.message);
				return sendJson(res, 500, { ok: false, error: err.message });
			}
		}

		// Route: GET /schedule-config (Business Hours, Holidays, Unavailability, Shift Hours via ZRC GET)
		if (req.method === 'GET' && pathname.endsWith('/schedule-config')) {
			try {
				const [bhRes, holRes, unavailRes, shiftRes] = await Promise.allSettled([
					zrc.get('/crm/v8/settings/business_hours'),
					zrc.get('/crm/v8/settings/holidays'),
					zrc.get('/crm/v8/settings/users_unavailability'),
					zrc.get('/crm/v8/settings/business_hours/shift_hours')
				]);

				let businessHours = null;
				if (bhRes.status === 'fulfilled' && bhRes.value.ok) {
					const bhData = bhRes.value.data;
					businessHours = bhData?.business_hours || (Array.isArray(bhData?.data) ? bhData.data[0] : null) || null;
				}

				let holidays = [];
				if (holRes.status === 'fulfilled' && holRes.value.ok) {
					const holData = holRes.value.data;
					holidays = holData?.holidays || (Array.isArray(holData?.data) ? holData.data : []) || [];
				}

				let unavailabilities = [];
				if (unavailRes.status === 'fulfilled' && unavailRes.value.ok) {
					const uData = unavailRes.value.data;
					unavailabilities = uData?.users_unavailability || uData?.user_unavailability || (Array.isArray(uData?.data) ? uData.data : []) || [];
				}

				let shiftHours = [];
				if (shiftRes.status === 'fulfilled' && shiftRes.value.ok) {
					const sData = shiftRes.value.data;
					shiftHours = sData?.shift_hours || (Array.isArray(sData?.data) ? sData.data : []) || [];
				}

				return sendJson(res, 200, {
					ok: true,
					businessHours,
					holidays,
					unavailabilities,
					shiftHours
				});
			} catch (e) {
				console.error('Schedule config error via ZRC:', e.message);
				return sendJson(res, 500, { ok: false, error: e.message });
			}
		}

		// Route: GET /booked-slots?date=YYYY-MM-DD&doctorId=... (via ZRC COQL)
		if (req.method === 'GET' && (pathname.endsWith('/booked-slots') || pathname.endsWith('/appointments/booked'))) {
			const dateParam = parsedUrl.searchParams.get('date');
			const doctorIdParam = parsedUrl.searchParams.get('doctorId') || parsedUrl.searchParams.get('doctor');

			try {
				let booked = [];

				// Attempt 1: Target COQL query for appointments on this date
				if (dateParam) {
					try {
						const coqlQuery = `select id, Appointment_Start_Time, Appointment_End_Time, Status, Service_Name, Practitioner, Doctor from Appointments__s where Status != 'Cancelled' and Appointment_Start_Time between '${dateParam}T00:00:00+05:30' and '${dateParam}T23:59:59+05:30'`;
						const coqlRes = await zrc.coql(coqlQuery);
						if (coqlRes.ok && Array.isArray(coqlRes.data?.data)) {
							booked = coqlRes.data.data
								.filter(a => {
									if (doctorIdParam) {
										const docId = a.Practitioner?.id || a.Doctor?.id;
										if (docId && String(docId) !== String(doctorIdParam)) return false;
									}
									return true;
								})
								.map(a => ({
									id: a.id,
									startTime: a.Appointment_Start_Time,
									endTime: a.Appointment_End_Time,
									status: a.Status,
									doctorId: a.Practitioner?.id || a.Doctor?.id || null
								}));
						}
					} catch (cErr) {
						console.warn('Booked slots COQL failed, using ZRC GET fallback:', cErr.message);
					}
				}

				// Attempt 2: ZRC GET fallback if COQL had no records or was skipped
				if (booked.length === 0) {
					const aRes = await zrc.get('/crm/v8/Appointments__s', {
						params: {
							fields: 'id,Appointment_Start_Time,Appointment_End_Time,Status,Service_Name,Practitioner,Doctor',
							per_page: 100
						}
					});
					const aList = aRes.data?.data || [];
					booked = aList
						.filter(a => {
							if (dateParam && (!a.Appointment_Start_Time || !a.Appointment_Start_Time.startsWith(dateParam))) return false;
							if (doctorIdParam) {
								const docId = a.Practitioner?.id || a.Doctor?.id;
								if (docId && String(docId) !== String(doctorIdParam)) return false;
							}
							return true;
						})
						.map(a => ({
							id: a.id,
							startTime: a.Appointment_Start_Time,
							endTime: a.Appointment_End_Time,
							status: a.Status,
							doctorId: a.Practitioner?.id || a.Doctor?.id || null
						}));
				}

				return sendJson(res, 200, { ok: true, booked });
			} catch (e) {
				console.error('Booked slots fetch error:', e.message);
				return sendJson(res, 500, { ok: false, error: e.message, booked: [] });
			}
		}

		// Route: POST /book-appointment or /appointment/create -> Creates record via ZRC POST
		if (req.method === 'POST' && (pathname.endsWith('/book-appointment') || pathname.endsWith('/appointment/create'))) {
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
				chiefComplaint,
				additionalInfo,
				matchedPatientId
			} = body;

			const fullName = (patientName || `${firstName || ''} ${lastName || ''}`).trim();

			if (!fullName || !visitDate) {
				return sendJson(res, 400, {
					ok: false,
					error: 'Patient Name and Appointment Date are required.'
				});
			}

			// 1. Resolve Appointment_For target via ZRC / COQL
			const apptFor = await resolveAppointmentFor({
				firstName,
				lastName,
				patientName: fullName,
				mobileNumber,
				email,
				matchedPatientId: matchedPatientId || body.matchedPatient?.id || null
			});

			if (!apptFor || !apptFor.id) {
				return sendJson(res, 400, {
					ok: false,
					error: 'Could not link or register prospect Contact in PMS for this appointment.'
				});
			}

			// 2. Resolve Service / Department ID
			let serviceId = service?.id || department?.id;
			let serviceName = service?.name || department?.name || 'Consultation';
			let serviceDuration = duration || service?.duration || department?.duration || 30;

			if (!serviceId) {
				try {
					const sRes = await zrc.get('/crm/v8/Services__s', {
						params: { fields: 'id,Service_Name,Duration', per_page: 1 }
					});
					const firstService = sRes.data?.data?.[0];
					if (firstService) {
						serviceId = firstService.id;
						serviceName = firstService.Service_Name;
						serviceDuration = firstService.Duration || 30;
					}
				} catch (sErr) {
					console.warn('Could not lookup default service:', sErr.message);
				}
			}

			// 3. Format DateTimes: "YYYY-MM-DDTHH:mm:00+05:30"
			const timePart = startTime ? startTime.replace(/\s*(AM|PM)/i, '').trim() : '10:00';
			const isPM = startTime && startTime.toUpperCase().includes('PM');
			let [hrs, mins] = timePart.split(':').map(Number);
			if (isPM && hrs < 12) hrs += 12;
			if (!isPM && startTime && startTime.toUpperCase().includes('AM') && hrs === 12) hrs = 0;
			const pad = (n) => String(n).padStart(2, '0');
			const safeHrs = (hrs !== undefined && !isNaN(hrs)) ? hrs : 10;
			const safeMins = (mins !== undefined && !isNaN(mins)) ? mins : 0;
			const startDateTimeStr = `${visitDate}T${pad(safeHrs)}:${pad(safeMins)}:00+05:30`;

			const endDate = new Date(new Date(startDateTimeStr).getTime() + (Number(serviceDuration) || 30) * 60 * 1000);
			const endDateTimeStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00+05:30`;

			// 4. Construct record for Appointments__s
			const finalAppointmentName = appointmentName?.trim() || `${serviceName} - ${fullName}`;

			const appointmentRecord = {
				Appointment_Name: finalAppointmentName,
				Appointment_For: {
					id: String(apptFor.id),
					module: { api_name: apptFor.module.api_name }
				},
				Location: 'Business Address',
				Appointment_Start_Time: startDateTimeStr,
				Appointment_End_Time: endDateTimeStr,
				Status: 'Scheduled',
				Priority: priority || 'Routine',
				Chief_Complaint: chiefComplaint || 'Clinical Consultation',
				...(additionalInfo ? { Description: additionalInfo } : {})
			};

			if (serviceId) {
				appointmentRecord.Service_Name = { id: String(serviceId) };
			}

			let targetDocId = doctor?.id || body.doctorId;
			if (!targetDocId) {
				try {
					const uRes = await zrc.get('/crm/v8/users', { params: { type: 'ActiveUsers', per_page: 1 } });
					targetDocId = uRes.data?.users?.[0]?.id;
				} catch (uErr) {
					console.warn('Could not fetch default doctor user:', uErr.message);
				}
			}

			if (targetDocId) {
				appointmentRecord.Owner = { id: String(targetDocId) };
			}

			// 5. Insert record into Appointments__s via ZRC POST
			const insertRes = await zrc.post('/crm/v8/Appointments__s', {
				data: [appointmentRecord],
				trigger: ['workflow', 'approval']
			});

			const insertData = insertRes.data || {};
			const result = insertData.data?.[0];

			if (result?.code === 'SUCCESS') {
				return sendJson(res, 200, {
					ok: true,
					appointmentId: result.details?.id,
					id: result.details?.id,
					appointmentName: appointmentRecord.Appointment_Name,
					appointmentFor: apptFor,
					isProspect: apptFor.isProspect,
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
			version: '3.0.0',
			client: 'ZRC / Zoho CRM v8 SDK',
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
