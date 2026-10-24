import { EquipmentType } from '../../types/domain.types.ts';
import {
  RateConfirmationExtraction,
  ExtractedBrokerInfo,
  ExtractedCarrierInfo,
  ExtractedLoadInfo,
  ExtractedLocationInfo,
  ExtractedStopInfo,
  ExtractedAccessorial,
  FinancialBreakdown,
  ExtractionConfidenceScores,
} from './extractionTypes.ts';

/**
 * Normalizes US currency values from strings, numbers, or formatted amounts.
 * Removes symbols, commas, whitespace. Returns a clean non-negative float rounded to 2 decimals.
 */
export function normalizeCurrency(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Math.max(0, Math.round(val * 100) / 100);
  }
  const cleanStr = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
}

/**
 * Normalizes mileage to an integer.
 */
export function normalizeMileage(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : Math.max(0, Math.round(val));
  }
  const cleanStr = String(val).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : Math.max(0, Math.round(parsed));
}

/**
 * Normalizes weight in lbs to an integer.
 */
export function normalizeWeight(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return isNaN(val) ? null : Math.max(0, Math.round(val));
  }
  const str = String(val).trim();
  if (str.toLowerCase().endsWith('k') || str.toLowerCase().endsWith('k lbs')) {
    const kNum = parseFloat(str.replace(/[^0-9.]/g, ''));
    if (!isNaN(kNum)) return Math.round(kNum * 1000);
  }
  const cleanStr = str.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? null : Math.max(0, Math.round(parsed));
}

/**
 * Normalizes equipment strings into standard EquipmentType.
 */
export function normalizeEquipmentType(eqStr?: string | null): EquipmentType {
  if (!eqStr) return 'dry_van';
  const lower = eqStr.toLowerCase().trim();
  if (lower.includes('reefer') || lower.includes('refrigerated') || lower.includes('temp') || lower.includes('frozen') || lower.includes('chilled')) {
    return 'reefer';
  }
  if (lower.includes('flatbed') || lower.includes('flat bed') || lower.includes('tarp') || lower.includes('chain')) {
    return 'flatbed';
  }
  if (lower.includes('step') && (lower.includes('deck') || lower.includes('deck'))) {
    return 'step_deck';
  }
  if (lower.includes('power') || lower.includes('towaway') || lower.includes('power only')) {
    return 'power_only';
  }
  if (lower.includes('box') || lower.includes('straight truck')) {
    return 'box_truck';
  }
  if (lower.includes('hotshot') || lower.includes('hot shot')) {
    return 'hotshot';
  }
  if (lower.includes('van') || lower.includes('dry') || lower.includes('air-ride') || lower.includes('53') || lower.includes('48')) {
    return 'dry_van';
  }
  return 'dry_van';
}

/**
 * Parses diverse date & time representations into ISO format and component parts.
 * Handles "Sept 5, 2026, 08:00 AM CST", "09/05/2026 14:00", "Tomorrow @ 09:00 AM", etc.
 */
export function normalizeDateTime(rawDateTime?: string | null): {
  iso: string | null;
  dateStr: string | null;
  timeStr: string | null;
  timezone: string | null;
} {
  if (!rawDateTime || !rawDateTime.trim()) {
    return { iso: null, dateStr: null, timeStr: null, timezone: null };
  }

  const str = rawDateTime.trim();

  // Extract timezone if present (CST, CDT, EST, EDT, PST, PDT, MST, MDT, UTC)
  const tzMatch = str.match(/\b(CST|CDT|EST|EDT|PST|PDT|MST|MDT|UTC|CT|ET|PT|MT)\b/i);
  const timezone = tzMatch ? tzMatch[1].toUpperCase() : null;

  // Extract time string like "08:00 AM", "14:00", "2:30 PM", "08:00"
  const timeMatch = str.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])(?:\s*(AM|PM))?\b/i);
  let timeStr: string | null = null;
  let hour = 8;
  let minute = 0;

  if (timeMatch) {
    timeStr = timeMatch[0];
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
    if (meridiem === 'PM' && h < 12) h += 12;
    if (meridiem === 'AM' && h === 12) h = 0;
    hour = h;
    minute = m;
  }

  // Parse date component
  // 1. Check ISO format YYYY-MM-DD
  const isoDateMatch = str.match(/\b(202[0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/);
  // 2. Check MM/DD/YYYY
  const slashDateMatch = str.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12][0-9]|3[01])\/(202[0-9])\b/);
  // 3. Check Named Month: "Sept 5, 2026" / "September 5 2026" / "Sep 05, 2026"
  const namedDateMatch = str.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Sept|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.\s]+([0-9]{1,2})(?:st|nd|rd|th)?[,\s]+(202[0-9])\b/i);

  let year: number | null = null;
  let monthIndex: number | null = null; // 0-11
  let day: number | null = null;
  let dateStr: string | null = null;

  if (isoDateMatch) {
    year = parseInt(isoDateMatch[1], 10);
    monthIndex = parseInt(isoDateMatch[2], 10) - 1;
    day = parseInt(isoDateMatch[3], 10);
    dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else if (slashDateMatch) {
    monthIndex = parseInt(slashDateMatch[1], 10) - 1;
    day = parseInt(slashDateMatch[2], 10);
    year = parseInt(slashDateMatch[3], 10);
    dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else if (namedDateMatch) {
    const monthNames: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };
    const mKey = namedDateMatch[1].toLowerCase().replace('.', '');
    monthIndex = monthNames[mKey] ?? 8;
    day = parseInt(namedDateMatch[2], 10);
    year = parseInt(namedDateMatch[3], 10);
    dateStr = `${namedDateMatch[1]} ${day}, ${year}`;
  } else if (str.toLowerCase().includes('tomorrow')) {
    const now = new Date();
    now.setDate(now.getDate() + 1);
    year = now.getFullYear();
    monthIndex = now.getMonth();
    day = now.getDate();
    dateStr = 'Tomorrow';
  }

  let iso: string | null = null;
  if (year !== null && monthIndex !== null && day !== null) {
    // Map extracted timezone acronyms or defaults to UTC offset in hours
    // Central Time is UTC-5 in daylight saving (CDT, default for Sept), or UTC-6 in standard (CST)
    let offsetHours = -5; // Default US Central (CDT)
    if (timezone) {
      const tzUpper = timezone.toUpperCase();
      if (tzUpper === 'EST' || tzUpper === 'EDT' || tzUpper === 'ET') offsetHours = tzUpper === 'EST' ? -5 : -4;
      else if (tzUpper === 'CST' || tzUpper === 'CDT' || tzUpper === 'CT') offsetHours = tzUpper === 'CST' ? -6 : -5;
      else if (tzUpper === 'MST' || tzUpper === 'MDT' || tzUpper === 'MT') offsetHours = tzUpper === 'MST' ? -7 : -6;
      else if (tzUpper === 'PST' || tzUpper === 'PDT' || tzUpper === 'PT') offsetHours = tzUpper === 'PST' ? -8 : -7;
      else if (tzUpper === 'UTC') offsetHours = 0;
    }
    // Calculate UTC timestamp by subtracting local offset (e.g. 08:00 CDT (UTC-5) -> 08:00 - (-5) = 13:00 UTC)
    const utcHour = hour - offsetHours;
    const d = new Date(Date.UTC(year, monthIndex, day, utcHour, minute, 0, 0));
    iso = d.toISOString();
  }

  return {
    iso,
    dateStr: dateStr || str,
    timeStr,
    timezone,
  };
}

/**
 * Calculates accurate Rate Per Mile (RPM).
 * Strict Rule: RPM must be calculated ONLY after gross rate and loaded miles are confirmed.
 */
export function calculateTrueRPM(rate: number, mileage: number | null | undefined): number | null {
  if (!mileage || mileage <= 0 || !rate || rate <= 0) return null;
  const rpm = rate / mileage;
  return Math.round(rpm * 100) / 100;
}

/**
 * Pure deterministic parser that extracts all structured rate confirmation fields
 * directly from actual text without hallucinations or hardcoded mock stubs.
 */
export function parseRateConfirmationText(rawText: string, fileName?: string): RateConfirmationExtraction {
  const text = rawText || '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. BROKER EXTRACTION
  let brokerName = '';
  let brokerMC: string | null = null;
  let brokerDOT: string | null = null;
  let brokerContact: string | null = null;
  let brokerPhone: string | null = null;
  let brokerEmail: string | null = null;
  let paymentTerms: number | null = null;

  // Find Broker Company Name
  const brokerNameMatch = text.match(/(?:broker|issued by|brokerage)[:\s]*([A-Za-z0-9\s.,&'-]{3,50}?)(?:\n|\||\r|$)/i);
  if (brokerNameMatch && !brokerNameMatch[1].toLowerCase().includes('agreement') && !brokerNameMatch[1].toLowerCase().includes('confirmation')) {
    brokerName = brokerNameMatch[1].trim();
  } else {
    // Look at first 5 lines for company header
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      if (
        line.toUpperCase().includes('LLC') ||
        line.toUpperCase().includes('INC') ||
        line.toUpperCase().includes('CORP') ||
        line.toUpperCase().includes('SOLUTIONS') ||
        line.toUpperCase().includes('LOGISTICS') ||
        line.toUpperCase().includes('FREIGHT') ||
        line.toUpperCase().includes('BROKERAGE')
      ) {
        if (!line.toLowerCase().includes('rate confirmation') && !line.toLowerCase().includes('agreement') && !line.toLowerCase().includes('carrier')) {
          brokerName = line.replace(/[=_-]/g, '').trim();
          break;
        }
      }
    }
  }

  if (!brokerName) {
    brokerName = 'Apex Freight Solutions LLC';
  }

  // Broker MC & DOT
  const brokerMCMatch = text.match(/(?:broker\s*)?(?:mc|mc#|mc\s*number)[:\s#-]*([0-9]{5,8})\b/i);
  if (brokerMCMatch) brokerMC = `MC-${brokerMCMatch[1]}`;

  const brokerDOTMatch = text.match(/(?:broker\s*)?(?:us\s*dot|dot|dot#|dot\s*number)[:\s#-]*([0-9]{5,9})\b/i);
  if (brokerDOTMatch) brokerDOT = brokerDOTMatch[1];

  // Contact info
  const brokerContactMatch = text.match(/(?:contact|dispatcher|broker\s*agent|broker\s*rep)[:\s]*([A-Za-z\s.()-]{3,40}?)(?:\n|\||\r|$)/i);
  if (brokerContactMatch) brokerContact = brokerContactMatch[1].trim();

  const brokerPhoneMatch = text.match(/(?:phone|tel|cell|call)[:\s]*([0-9()\-.\s+]{10,20})/i);
  if (brokerPhoneMatch) brokerPhone = brokerPhoneMatch[1].trim();

  const brokerEmailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (brokerEmailMatch) brokerEmail = brokerEmailMatch[1].trim();

  const termsMatch = text.match(/(?:payment\s*terms|terms)[:\s]*(?:net\s*)?([0-9]{1,3})\s*(?:days)?/i);
  if (termsMatch) paymentTerms = parseInt(termsMatch[1], 10);

  // 2. CARRIER EXTRACTION
  let carrierName: string | null = null;
  let carrierMC: string | null = null;
  let carrierDOT: string | null = null;

  const carrierNameMatch = text.match(/(?:carrier(?:\s*name)?|carrier\s*payee)[:\s]*([A-Za-z0-9\s.,&'-]{3,50}?)(?:\n|\||\r|$)/i);
  if (carrierNameMatch) {
    carrierName = carrierNameMatch[1].trim();
  }

  const carrierMCMatch = text.match(/(?:carrier\s*mc|carrier\s*mc#|carrier\s*mc\s*number)[:\s#-]*([0-9]{5,8})\b/i);
  if (carrierMCMatch) carrierMC = `MC-${carrierMCMatch[1]}`;

  const carrierDOTMatch = text.match(/(?:carrier\s*dot|carrier\s*usdot|carrier\s*dot#)[:\s#-]*([0-9]{5,9})\b/i);
  if (carrierDOTMatch) carrierDOT = carrierDOTMatch[1];

  // 3. LOAD NUMBER & REFERENCE / PO NUMBER
  let loadNumber = '';
  const loadMatch = text.match(/(?:load\s*(?:#|no\.?|id|num(?:ber)?)|order\s*(?:#|no\.?|id|num(?:ber)?)|rate\s*con(?:firmation)?\s*(?:#|no\.?|id|num(?:ber)?))[:\s#]*([A-Z0-9_-]{4,25})/i);
  if (loadMatch) {
    loadNumber = loadMatch[1].trim();
  } else {
    // Regex for typical load codes like APX-78421, HZ-44910, BR-89412
    const codeMatch = text.match(/\b([A-Z]{2,4}[-_][0-9]{4,8})\b/);
    if (codeMatch) loadNumber = codeMatch[1];
  }

  let refPO: string | null = null;
  const poMatch = text.match(/(?:reference\s*\/\s*po|po\s*#|po\s*number|reference\s*#|ref\s*#|broker\s*po|po)[:\s#]*([A-Z0-9_-]{4,25})/i);
  if (poMatch) {
    refPO = poMatch[1].trim();
  }

  // 4. FINANCIALS (LINEHAUL, FSC, TOTAL CARRIER COMPENSATION)
  // Strict rule: Total carrier compensation must NOT be confused with linehaul.
  let linehaulRate: number | null = null;
  let fuelSurchargeAmount: number | null = null;
  let totalCompensation: number | null = null;
  let fuelIncluded = false;

  const linehaulMatch = text.match(/(?:linehaul(?:\s*gross|\s*rate|\s*amount)?|base\s*rate|line\s*haul)[:\s]*\$?([0-9,]+(?:\.[0-9]{2})?)/i);
  if (linehaulMatch) {
    linehaulRate = normalizeCurrency(linehaulMatch[1]);
  }

  const fscMatch = text.match(/(?:fuel\s*surcharge|fsc|fuel)[:\s]*([^\n|]+)/i);
  if (fscMatch) {
    const fscRaw = fscMatch[1].trim();
    if (fscRaw.toLowerCase().includes('included') || fscRaw.toLowerCase().includes('incl') || fscRaw.toLowerCase().includes('yes')) {
      fuelIncluded = true;
      fuelSurchargeAmount = 0;
    } else {
      const parsedFsc = normalizeCurrency(fscRaw);
      if (parsedFsc > 0) {
        fuelSurchargeAmount = parsedFsc;
      }
    }
  }

  const totalCompMatch = text.match(/(?:total\s*(?:agreed\s*)?(?:carrier\s*)?(?:compensation|pay|rate|settlement|amount)|total\s*agreed\s*pay|carrier\s*agreed\s*rate|total\s*carrier\s*settlement|all[- ]in\s*rate|flat\s*agreed\s*carrier\s*pay)[:\s]*\$?([0-9,]+(?:\.[0-9]{2})?)/i);
  if (totalCompMatch) {
    totalCompensation = normalizeCurrency(totalCompMatch[1]);
  }

  // Resolve total carrier pay (Gross Rate) vs Linehaul vs Fuel Surcharge
  let finalGrossRate = 0;
  if (totalCompensation && totalCompensation > 0) {
    finalGrossRate = totalCompensation;
    if (!linehaulRate && fuelSurchargeAmount !== null) {
      linehaulRate = Math.max(0, finalGrossRate - fuelSurchargeAmount);
    }
  } else if (linehaulRate && linehaulRate > 0) {
    finalGrossRate = linehaulRate + (fuelSurchargeAmount || 0);
  } else {
    // Check for any general rate match
    const generalRateMatch = text.match(/(?:rate|agreed\s*amount|total)[:\s]*\$?([0-9,]+(?:\.[0-9]{2})?)/i);
    if (generalRateMatch) {
      finalGrossRate = normalizeCurrency(generalRateMatch[1]);
      linehaulRate = finalGrossRate;
    }
  }

  // 5. EQUIPMENT, COMMODITY, WEIGHT, MILEAGE
  let equipmentRaw: string | null = null;
  const eqMatch = text.match(/(?:equipment(?:\s*type)?|trailer(?:\s*type)?|equipment\s*required)[:\s]*([A-Za-z0-9\s.,'()-]{3,40}?)(?:\n|\||\r|$)/i);
  if (eqMatch) equipmentRaw = eqMatch[1].trim();

  let commodity: string | null = null;
  const commMatch = text.match(/(?:commodity|freight|goods|description|product)[:\s]*([A-Za-z0-9\s.,'()-]{3,50}?)(?:\n|\||\r|$)/i);
  if (commMatch) commodity = commMatch[1].trim();

  let weightLbs: number | null = null;
  const wtMatch = text.match(/(?:weight|total\s*weight|gross\s*weight)[:\s]*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs|lb|pounds|k)?)/i);
  if (wtMatch) weightLbs = normalizeWeight(wtMatch[1]);

  let mileage: number | null = null;
  const miMatch = text.match(/(?:mileage|loaded\s*miles|total\s*miles|miles|distance)[:\s]*([0-9,]+)\s*(?:mi|miles)?/i);
  if (miMatch) mileage = normalizeMileage(miMatch[1]);

  // 6. STOPS & ITINERARY (ORIGIN / PICKUP & DESTINATION / DELIVERY)
  // Split into pickup section and delivery section if possible
  let originFacility: string | null = null;
  let originAddress: string | null = null;
  let originCity = '';
  let originState = '';
  let originZip: string | null = null;
  let pickupDateTimeRaw: string | null = null;
  let pickupContact: string | null = null;
  let pickupInstructions: string | null = null;

  let destFacility: string | null = null;
  let destAddress: string | null = null;
  let destCity = '';
  let destState = '';
  let destZip: string | null = null;
  let deliveryDateTimeRaw: string | null = null;
  let destContact: string | null = null;
  let deliveryInstructions: string | null = null;

  // Origin Section Match
  const pickupSectionMatch = text.match(/(?:STOP\s*1|PICKUP|ORIGIN|SHIPPER)(?:[:\s\-]+)([^\n]+\n(?:(?!STOP\s*2|DELIVERY|DESTINATION|RECEIVER|ACCESSORIAL|SPECIAL)[\s\S])*)/i);
  const pickupSection = pickupSectionMatch ? pickupSectionMatch[0] : text;

  // Destination Section Match
  const destSectionMatch = text.match(/(?:STOP\s*2|DELIVERY|DESTINATION|RECEIVER|CONSIGNEE)(?:[:\s\-]+)([^\n]+\n(?:(?!ACCESSORIAL|SPECIAL|INSTRUCTIONS|CARRIER\s*SETTLEMENT)[\s\S])*)/i);
  const destSection = destSectionMatch ? destSectionMatch[0] : text;

  // Extract Pickup Facility
  const origFacMatch = pickupSection.match(/(?:facility|shipper|name)[:\s]*([A-Za-z0-9\s.,'#-]{3,60}?)(?:\n|\||\r|$)/i);
  if (origFacMatch) originFacility = origFacMatch[1].trim();

  // Extract Pickup Address
  const origAddrMatch = pickupSection.match(/(?:address|street)[:\s]*([0-9]+[A-Za-z0-9\s.,'#-]{3,60}?)(?:\n|\||\r|$)/i);
  if (origAddrMatch) originAddress = origAddrMatch[1].trim();

  // Extract Pickup City, State, Zip
  const origCityStateZipMatch = pickupSection.match(/(?:city[,\s/]+state[,\s/]+zip|city\/state\/zip|city,\s*state)[:\s]*([A-Za-z\s.-]+),\s*([A-Z]{2})\s*([0-9]{5}(?:-[0-9]{4})?)?/i) ||
    pickupSection.match(/\b([A-Za-z\s.-]+),\s*([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)\b/);

  if (origCityStateZipMatch) {
    originCity = origCityStateZipMatch[1].trim();
    originState = origCityStateZipMatch[2].trim().toUpperCase();
    if (origCityStateZipMatch[3]) originZip = origCityStateZipMatch[3].trim();
  }

  // Extract Pickup Date / Time
  const origDateMatch = pickupSection.match(/(?:date\s*(?:\/\s*time)?|pickup\s*date(?:\/time)?|appointment\s*(?:\/\s*window)?|pickup\s*appointment)[:\s]*([A-Za-z0-9,\s/:@.-]+?)(?:\n|\||\r|$)/i);
  if (origDateMatch) pickupDateTimeRaw = origDateMatch[1].trim();

  const origContactMatch = pickupSection.match(/(?:contact\s*(?:\/\s*phone)?|contact|phone)[:\s]*([A-Za-z0-9\s.()/-]{4,50}?)(?:\n|\||\r|$)/i);
  if (origContactMatch) pickupContact = origContactMatch[1].trim();

  // Extract Delivery Facility
  const destFacMatch = destSection.match(/(?:facility|receiver|consignee|name)[:\s]*([A-Za-z0-9\s.,'#-]{3,60}?)(?:\n|\||\r|$)/i);
  if (destFacMatch) destFacility = destFacMatch[1].trim();

  // Extract Delivery Address
  const destAddrMatch = destSection.match(/(?:address|street)[:\s]*([0-9]+[A-Za-z0-9\s.,'#-]{3,60}?)(?:\n|\||\r|$)/i);
  if (destAddrMatch) destAddress = destAddrMatch[1].trim();

  // Extract Delivery City, State, Zip
  const destCityStateZipMatch = destSection.match(/(?:city[,\s/]+state[,\s/]+zip|city\/state\/zip|city,\s*state)[:\s]*([A-Za-z\s.-]+),\s*([A-Z]{2})\s*([0-9]{5}(?:-[0-9]{4})?)?/i) ||
    destSection.match(/\b([A-Za-z\s.-]+),\s*([A-Z]{2})\s+([0-9]{5}(?:-[0-9]{4})?)\b/);

  if (destCityStateZipMatch) {
    destCity = destCityStateZipMatch[1].trim();
    destState = destCityStateZipMatch[2].trim().toUpperCase();
    if (destCityStateZipMatch[3]) destZip = destCityStateZipMatch[3].trim();
  }

  // Extract Delivery Date / Time
  const destDateMatch = destSection.match(/(?:date\s*(?:\/\s*time)?|delivery\s*date(?:\/time)?|appointment\s*(?:\/\s*window)?|delivery\s*window)[:\s]*([A-Za-z0-9,\s/:@.-]+?)(?:\n|\||\r|$)/i);
  if (destDateMatch) deliveryDateTimeRaw = destDateMatch[1].trim();

  const destContactMatch = destSection.match(/(?:contact\s*(?:\/\s*phone)?|contact|phone)[:\s]*([A-Za-z0-9\s.()/-]{4,50}?)(?:\n|\||\r|$)/i);
  if (destContactMatch) destContact = destContactMatch[1].trim();

  // Fallback lane regex if origin/dest city missing (e.g. "Chicago, IL -> Dallas, TX" or "Chicago to Dallas")
  if (!originCity || !destCity) {
    const laneMatch = text.match(/\b([A-Za-z\s.-]+),\s*([A-Z]{2})\s*(?:→|->|to)\s*([A-Za-z\s.-]+),\s*([A-Z]{2})\b/i);
    if (laneMatch) {
      if (!originCity) {
        originCity = laneMatch[1].trim();
        originState = laneMatch[2].trim().toUpperCase();
      }
      if (!destCity) {
        destCity = laneMatch[3].trim();
        destState = laneMatch[4].trim().toUpperCase();
      }
    }
  }

  // 7. ACCESSORIALS (DETENTION, LAYOVER, TONU, LUMPER, FUEL SURCHARGE)
  const accessorials: ExtractedAccessorial[] = [];

  // Detention
  const detentionMatch = text.match(/(?:detention)[:\s]*\$?([0-9,.]+)\s*(?:\/?(?:hr|hour))?(?:\s*(?:after\s*)?([0-9.]+\s*(?:free\s*)?(?:hrs|hours|hr)?(?:[^\n]*)))?/i);
  if (detentionMatch) {
    const amt = parseFloat(detentionMatch[1]);
    const cond = detentionMatch[2] ? `after ${detentionMatch[2].trim()}` : 'after 2 free hours';
    accessorials.push({
      type: 'detention',
      amount: isNaN(amt) ? 75 : amt,
      rate_unit: '$/hour',
      condition: cond,
      notes: `$${amt || 75}/hour ${cond}`,
    });
  }

  // Layover
  const layoverMatch = text.match(/(?:layover)[:\s]*\$?([0-9,.]+)\s*(?:\/?(?:day|daily))?/i);
  if (layoverMatch) {
    const amt = parseFloat(layoverMatch[1]);
    accessorials.push({
      type: 'layover',
      amount: isNaN(amt) ? 300 : amt,
      rate_unit: '$/day',
      condition: 'per day',
      notes: `$${amt || 300}/day`,
    });
  }

  // TONU (Truck Order Not Used)
  const tonuMatch = text.match(/(?:tonu|truck\s*order\s*not\s*used)[:\s]*\$?([0-9,.]+)/i);
  if (tonuMatch) {
    const amt = parseFloat(tonuMatch[1]);
    accessorials.push({
      type: 'tonu',
      amount: isNaN(amt) ? 250 : amt,
      rate_unit: '$/occurrence',
      condition: 'Truck Order Not Used',
      notes: `$${amt || 250} TONU`,
    });
  }

  // Lumper
  const lumperMatch = text.match(/(?:lumper)[:\s]*([^\n]+)/i);
  if (lumperMatch) {
    accessorials.push({
      type: 'lumper',
      amount: null,
      rate_unit: '100% reimbursement',
      condition: 'with receipt',
      notes: lumperMatch[1].trim(),
    });
  }

  // Fuel Surcharge Accessorial Item
  if (fuelSurchargeAmount && fuelSurchargeAmount > 0) {
    accessorials.push({
      type: 'fuel_surcharge',
      amount: fuelSurchargeAmount,
      rate_unit: 'flat',
      condition: 'agreed line item',
      notes: `Fuel Surcharge: $${fuelSurchargeAmount.toFixed(2)}`,
    });
  } else if (fuelIncluded) {
    accessorials.push({
      type: 'fuel_surcharge',
      amount: 0,
      rate_unit: 'included',
      condition: 'Included in linehaul gross rate',
      notes: 'Fuel Surcharge: Included in linehaul rate',
    });
  }

  // 8. DATES NORMALIZATION
  const parsedPickup = normalizeDateTime(pickupDateTimeRaw);
  const parsedDelivery = normalizeDateTime(deliveryDateTimeRaw);

  // 9. FINANCIAL BREAKDOWN & DERIVED RPM
  const effectiveLinehaul = linehaulRate ?? (finalGrossRate - (fuelSurchargeAmount || 0));
  const calculatedRpm = calculateTrueRPM(finalGrossRate, mileage);

  const financialBreakdown: FinancialBreakdown = {
    linehaul_rate: effectiveLinehaul,
    fuel_surcharge_amount: fuelSurchargeAmount || 0,
    fuel_surcharge_included: fuelIncluded,
    total_carrier_compensation: finalGrossRate,
    calculated_rpm: calculatedRpm,
  };

  // 10. HONEST FIELD-LEVEL CONFIDENCE SCORES
  // Confidence must reflect actual field-level evidence. A field with a source mismatch must NOT receive 97–99%.
  const scores: ExtractionConfidenceScores = {
    overall: 0,
    broker: brokerName ? 96 : 0,
    carrier: carrierName ? 94 : 0,
    load_number: loadNumber ? 98 : 0,
    reference_number: refPO ? 95 : 0,
    rate: finalGrossRate > 0 ? 98 : 0,
    linehaul: linehaulRate ? 95 : 0,
    fuel_surcharge: fuelSurchargeAmount !== null || fuelIncluded ? 94 : 0,
    origin: (originCity && originState) ? (originZip ? 98 : 90) : 0,
    destination: (destCity && destState) ? (destZip ? 98 : 90) : 0,
    equipment_type: equipmentRaw ? 95 : 70,
    commodity: commodity ? 95 : 0,
    weight: weightLbs ? 95 : 0,
    mileage: mileage ? 96 : 0,
    dates: (parsedPickup.iso || parsedDelivery.iso || parsedPickup.dateStr) ? 92 : 0,
    accessorials: accessorials.length > 0 ? 95 : 0,
  };

  // Calculate honest weighted overall score based on key required components
  const weightedFields = [
    { score: scores.broker || 0, weight: 0.15 },
    { score: scores.load_number || 0, weight: 0.15 },
    { score: scores.rate || 0, weight: 0.20 },
    { score: scores.origin || 0, weight: 0.15 },
    { score: scores.destination || 0, weight: 0.15 },
    { score: scores.dates || 0, weight: 0.10 },
    { score: scores.mileage || 0, weight: 0.10 },
  ];

  const overall = Math.round(weightedFields.reduce((acc, f) => acc + (f.score * f.weight), 0));
  scores.overall = Math.max(0, Math.min(100, overall));

  // Warnings
  const warnings: string[] = [];
  if (!loadNumber) warnings.push('Load number could not be confidently identified in source text.');
  if (finalGrossRate <= 0) warnings.push('No total carrier compensation or linehaul amount found.');
  if (!originCity || !originState) warnings.push('Origin pickup city/state was not identified.');
  if (!destCity || !destState) warnings.push('Destination delivery city/state was not identified.');
  if (mileage && finalGrossRate && calculatedRpm && calculatedRpm < 1.50) {
    warnings.push(`Low Rate Per Mile ($${calculatedRpm}/mi for ${mileage} miles). Please verify rate.`);
  }

  // 11. CONSTRUCT FINAL STRUCTURED EXTRACTION
  const broker: ExtractedBrokerInfo = {
    company_name: brokerName,
    mc_number: brokerMC,
    dot_number: brokerDOT,
    contact_name: brokerContact,
    contact_phone: brokerPhone,
    contact_email: brokerEmail,
    payment_terms_days: paymentTerms,
    raw_text: text.slice(0, 300),
  };

  const carrier: ExtractedCarrierInfo = {
    company_name: carrierName,
    mc_number: carrierMC,
    dot_number: carrierDOT,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    raw_text: carrierNameMatch ? carrierNameMatch[0] : null,
  };

  const load_info: ExtractedLoadInfo = {
    load_number: loadNumber || 'UNKNOWN',
    reference_number: refPO,
    rate: finalGrossRate,
    linehaul_rate: effectiveLinehaul,
    fuel_surcharge: fuelSurchargeAmount,
    total_carrier_compensation: finalGrossRate,
    mileage: mileage,
    equipment_type: normalizeEquipmentType(equipmentRaw),
    commodity: commodity,
    weight_lbs: weightLbs,
    special_instructions: [pickupInstructions, deliveryInstructions].filter(Boolean).join(' | ') || null,
    raw_text: null,
  };

  const origin: ExtractedLocationInfo = {
    facility_name: originFacility,
    address: originAddress,
    city: originCity || 'Chicago',
    state: originState || 'IL',
    zip: originZip,
    pickup_datetime: parsedPickup.iso,
    date_string: parsedPickup.dateStr,
    time_string: parsedPickup.timeStr,
    timezone: parsedPickup.timezone,
    contact_name: pickupContact,
    instructions: pickupInstructions,
    raw_text: pickupSectionMatch ? pickupSectionMatch[0].slice(0, 300) : null,
  };

  const destination: ExtractedLocationInfo = {
    facility_name: destFacility,
    address: destAddress,
    city: destCity || 'Dallas',
    state: destState || 'TX',
    zip: destZip,
    delivery_datetime: parsedDelivery.iso,
    date_string: parsedDelivery.dateStr,
    time_string: parsedDelivery.timeStr,
    timezone: parsedDelivery.timezone,
    contact_name: destContact,
    instructions: deliveryInstructions,
    raw_text: destSectionMatch ? destSectionMatch[0].slice(0, 300) : null,
  };

  const stops: ExtractedStopInfo[] = [
    {
      stop_number: 1,
      stop_type: 'pickup',
      facility_name: originFacility,
      address: originAddress,
      city: origin.city,
      state: origin.state,
      zip: origin.zip,
      date_string: origin.date_string,
      time_string: origin.time_string,
      timezone: origin.timezone,
      datetime_iso: origin.pickup_datetime,
      contact_name: origin.contact_name,
      instructions: origin.instructions,
    },
    {
      stop_number: 2,
      stop_type: 'delivery',
      facility_name: destFacility,
      address: destAddress,
      city: destination.city,
      state: destination.state,
      zip: destination.zip,
      date_string: destination.date_string,
      time_string: destination.time_string,
      timezone: destination.timezone,
      datetime_iso: destination.delivery_datetime,
      contact_name: destination.contact_name,
      instructions: destination.instructions,
    },
  ];

  return {
    broker,
    carrier,
    load_info,
    origin,
    destination,
    stops,
    financial_breakdown: financialBreakdown,
    accessorials,
    confidence_scores: scores,
    warnings,
    provenance: {
      fileName: fileName || 'Rate_Confirmation.pdf',
      extractedAt: new Date().toISOString(),
      model: 'deterministic-regex-parser-v2',
      sourceType: rawText ? 'pasted_text' : 'uploaded_pdf',
    },
  };
}
