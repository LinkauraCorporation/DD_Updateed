import React, { useState, useEffect, useMemo } from 'react';
import {
  Client,
  Broker,
  Truck,
  Driver,
  PipelineStatus,
  EquipmentType,
  TeamMember,
} from '../../types/domain.types.ts';
import {
  LoadWithRelations,
  CreateLoadInput,
  UpdateLoadInput,
  PIPELINE_STATUS_OPTIONS,
  EQUIPMENT_TYPE_OPTIONS,
  US_STATES,
  isValidUsState,
} from './loadTypes.ts';
import { getAllowedTransitions } from '../pipeline/pipelineTypes.ts';
import { Modal } from '../../components/common/Modal.tsx';
import { LoadProfitabilityCard } from './LoadProfitabilityCard.tsx';
import { estimateDriverPay, estimateFuelCost, formatCurrency } from '../../lib/calculations.ts';
import { extractionService } from '../documents/extractionService.ts';
import { brokerService } from '../brokers/brokerService.ts';
import { normalizeEquipmentType } from '../documents/rateConParser.ts';
import { RateConfirmationExtraction, ExtractedBrokerInfo } from '../documents/extractionTypes.ts';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { useTimezone } from '../../contexts/TimezoneContext.tsx';
import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  toLocalDateString,
  parseDateAndTimeToInputs,
  constructIsoDatetime,
} from '../../lib/timezones.ts';
import {
  Building2,
  Truck as TruckIcon,
  UserCheck,
  ShieldCheck,
  MapPin,
  Calendar,
  DollarSign,
  PackageCheck,
  FileText,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Calculator,
  CheckCircle2,
  RefreshCw,
  X,
  Upload,
} from 'lucide-react';

// Format 24-hour time HH:MM with 12-hour AM/PM label
export const formatTimeOptionLabel = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const mm = mStr ? mStr.padStart(2, '0') : '00';
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${String(h).padStart(2, '0')}:${mm} (${displayHour}:${mm} ${period})`;
};

// 30-minute interval options for dispatcher schedule (00:00 through 23:30)
export const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      options.push({ value, label: formatTimeOptionLabel(value) });
    }
  }
  return options;
})();

export { toLocalDateString, parseDateAndTimeToInputs, constructIsoDatetime };

export interface LoadScheduleInput {
  pickupDate: string;
  pickupTime: string;
  deliveryDate: string;
  deliveryTime: string;
}

export interface DerivedLoadSchedule {
  pickup_datetime: string | null;
  delivery_datetime: string | null;
  isValid: boolean;
  validationError?: string;
}

/**
 * Single source of truth for deriving ISO timestamps directly from current UI selector values.
 */
export const deriveLoadScheduleFromInputs = (
  schedule: LoadScheduleInput,
  operationalTimezone: string = DEFAULT_OPERATIONAL_TIMEZONE
): DerivedLoadSchedule => {
  const pickup_datetime = constructIsoDatetime(schedule.pickupDate, schedule.pickupTime, operationalTimezone);
  const delivery_datetime = constructIsoDatetime(schedule.deliveryDate, schedule.deliveryTime, operationalTimezone);

  if (pickup_datetime && delivery_datetime) {
    if (new Date(delivery_datetime).getTime() < new Date(pickup_datetime).getTime()) {
      return {
        pickup_datetime,
        delivery_datetime,
        isValid: false,
        validationError: 'Delivery datetime cannot be earlier than pickup datetime.',
      };
    }
  }

  return {
    pickup_datetime,
    delivery_datetime,
    isValid: true,
  };
};

interface LoadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: CreateLoadInput | UpdateLoadInput, rateConFile?: File | null) => Promise<void>;
  initialLoad?: LoadWithRelations | null;
  clients: Client[];
  brokers: Broker[];
  trucks: Truck[];
  drivers: Driver[];
  teamMembers?: TeamMember[];
  nextLoadNumber?: string;
  isSaving?: boolean;
  organizationId?: string;
}

interface FormSnapshot {
  loadNumber: string;
  brokerId: string;
  pipelineStatus: PipelineStatus;
  equipmentType: EquipmentType;
  commodity: string;
  weightLbs: string;
  originFacilityName: string;
  originAddress: string;
  originCity: string;
  originState: string;
  originZip: string;
  pickupDate: string;
  pickupTime: string;
  destFacilityName: string;
  destAddress: string;
  destCity: string;
  destState: string;
  destZip: string;
  deliveryDate: string;
  deliveryTime: string;
  rate: string;
  loadedMiles: string;
  deadheadMiles: string;
  fuelExpense: string;
  driverPay: string;
  otherExpenses: string;
  specialInstructions: string;
}

export const LoadModal: React.FC<LoadModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialLoad,
  clients,
  brokers,
  trucks,
  drivers,
  teamMembers = [],
  nextLoadNumber,
  isSaving = false,
  organizationId: propOrganizationId,
}) => {
  const { activeOrganization } = useAuth();
  const { operationalTimezone } = useTimezone();
  const organizationId = propOrganizationId || activeOrganization?.id || 'demo-organization-default';
  const isEditing = !!initialLoad;

  // Form State
  const [loadNumber, setLoadNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [assignedDispatcherId, setAssignedDispatcherId] = useState('');
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('sourced');

  // Canonical pipeline transition filtering:
  // Shows only the current persisted status + valid transition targets.
  // Prevents invalid terminal jumps (e.g. booked -> invoiced, booked -> paid).
  const availableStatusOptions = useMemo(() => {
    const baseStatus: PipelineStatus = initialLoad?.pipeline_status || 'sourced';
    const allowedTargets = getAllowedTransitions(baseStatus);
    const validStatuses = new Set<PipelineStatus>([baseStatus, ...allowedTargets]);
    return PIPELINE_STATUS_OPTIONS.filter((opt) => validStatuses.has(opt.value));
  }, [initialLoad?.pipeline_status]);

  const [equipmentType, setEquipmentType] = useState<EquipmentType>('dry_van');
  const [commodity, setCommodity] = useState('');
  const [weightLbs, setWeightLbs] = useState('');

  // Origin / Pickup
  const [originFacilityName, setOriginFacilityName] = useState('');
  const [originAddress, setOriginAddress] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [originState, setOriginState] = useState('');
  const [originZip, setOriginZip] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [pickupTime, setPickupTime] = useState('08:00');

  // Destination / Delivery
  const [destFacilityName, setDestFacilityName] = useState('');
  const [destAddress, setDestAddress] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destState, setDestState] = useState('');
  const [destZip, setDestZip] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('17:00');

  // Financials & Miles
  const [rate, setRate] = useState<string>('');
  const [loadedMiles, setLoadedMiles] = useState<string>('');
  const [deadheadMiles, setDeadheadMiles] = useState<string>('0');
  const [fuelExpense, setFuelExpense] = useState<string>('');
  const [driverPay, setDriverPay] = useState<string>('');
  const [otherExpenses, setOtherExpenses] = useState<string>('');

  const [specialInstructions, setSpecialInstructions] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Rate Con PDF Upload & AI Extraction State
  const [rateConFile, setRateConFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionResult, setExtractionResult] = useState<RateConfirmationExtraction | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionNotice, setExtractionNotice] = useState<{
    fileName: string;
    confidence: number;
    fieldsCount: number;
  } | null>(null);
  const [formSnapshotBeforeExtraction, setFormSnapshotBeforeExtraction] = useState<FormSnapshot | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Unmatched extracted broker handling
  const [unmatchedBroker, setUnmatchedBroker] = useState<ExtractedBrokerInfo | null>(null);
  const [isCreatingBroker, setIsCreatingBroker] = useState(false);
  const [localBrokers, setLocalBrokers] = useState<Broker[]>([]);

  // Combined brokers list including any broker created on the fly in this modal
  const allBrokers = useMemo(() => {
    if (localBrokers.length === 0) return brokers;
    const map = new Map<string, Broker>();
    brokers.forEach((b) => map.set(b.id, b));
    localBrokers.forEach((b) => map.set(b.id, b));
    return Array.from(map.values());
  }, [brokers, localBrokers]);

  // Reset or populate on open
  useEffect(() => {
    if (!isOpen) return;

    setFormErrors({});
    setSubmitError(null);
    setIsSubmitting(false);

    // Reset extraction state
    setRateConFile(null);
    setIsExtracting(false);
    setExtractionResult(null);
    setExtractionError(null);
    setExtractionNotice(null);
    setFormSnapshotBeforeExtraction(null);
    setIsDragOver(false);
    setUnmatchedBroker(null);
    setIsCreatingBroker(false);
    setLocalBrokers([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (initialLoad) {
      setLoadNumber(initialLoad.load_number);
      setClientId(initialLoad.client_id || '');
      setBrokerId(initialLoad.broker_id || '');
      setTruckId(initialLoad.truck_id || '');
      setDriverId(initialLoad.driver_id || '');
      const rawDispatcherId = initialLoad.assigned_dispatcher_id 
        || initialLoad.assigned_team?.[0]?.user_id 
        || initialLoad.assigned_team_assignments?.[0]?.user_id 
        || '';
      const matchedMember = teamMembers.find((m) => m.user_id === rawDispatcherId || m.id === rawDispatcherId);
      setAssignedDispatcherId(matchedMember ? matchedMember.user_id : rawDispatcherId);
      setPipelineStatus(initialLoad.pipeline_status || 'booked');
      setEquipmentType(initialLoad.equipment_type || 'dry_van');
      setCommodity(initialLoad.commodity || '');
      setWeightLbs(initialLoad.weight_lbs ? String(initialLoad.weight_lbs) : '');

      setOriginFacilityName(initialLoad.origin_facility_name || '');
      setOriginAddress(initialLoad.origin_address || '');
      setOriginCity(initialLoad.origin_city || '');
      setOriginState(initialLoad.origin_state || 'TX');
      setOriginZip(initialLoad.origin_zip || '');

      if (initialLoad.pickup_datetime) {
        const parsed = parseDateAndTimeToInputs(initialLoad.pickup_datetime, operationalTimezone);
        setPickupDate(parsed.date);
        setPickupTime(parsed.time || '08:00');
      } else {
        setPickupDate('');
        setPickupTime('08:00');
      }

      setDestFacilityName(initialLoad.dest_facility_name || '');
      setDestAddress(initialLoad.dest_address || '');
      setDestCity(initialLoad.dest_city || '');
      setDestState(initialLoad.dest_state || 'GA');
      setDestZip(initialLoad.dest_zip || '');

      if (initialLoad.delivery_datetime) {
        const parsed = parseDateAndTimeToInputs(initialLoad.delivery_datetime, operationalTimezone);
        setDeliveryDate(parsed.date);
        setDeliveryTime(parsed.time || '17:00');
      } else {
        setDeliveryDate('');
        setDeliveryTime('17:00');
      }

      setRate(String(initialLoad.rate || 0));
      setLoadedMiles(String(initialLoad.loaded_miles || 0));
      setDeadheadMiles(String(initialLoad.deadhead_miles || 0));
      setFuelExpense(String(initialLoad.fuel_expense || 0));
      setDriverPay(String(initialLoad.driver_pay || 0));
      setOtherExpenses(String(initialLoad.other_expenses || 0));
      setSpecialInstructions(initialLoad.special_instructions || '');
    } else {
      // Default new load values
      setLoadNumber(nextLoadNumber || `LD-${new Date().getFullYear()}-8850`);
      setClientId('');
      setBrokerId('');
      setTruckId('');
      setDriverId('');

      setPipelineStatus('sourced');
      setEquipmentType('dry_van');
      setCommodity('');
      setWeightLbs('');
      setAssignedDispatcherId('');

      setOriginFacilityName('');
      setOriginAddress('');
      setOriginCity('');
      setOriginState('');
      setOriginZip('');

      // Default dates: tomorrow (+1 calendar day) and day after (+2 calendar days) in operational timezone
      const todayStr = toLocalDateString(new Date(), operationalTimezone);
      const [tYear, tMonth, tDay] = todayStr.split('-').map(Number);
      const pad = (n: number) => n.toString().padStart(2, '0');

      const tomorrowDate = new Date(Date.UTC(tYear, tMonth - 1, tDay + 1));
      const dayAfterDate = new Date(Date.UTC(tYear, tMonth - 1, tDay + 2));

      setPickupDate(`${tomorrowDate.getUTCFullYear()}-${pad(tomorrowDate.getUTCMonth() + 1)}-${pad(tomorrowDate.getUTCDate())}`);
      setPickupTime('08:00');

      setDestFacilityName('');
      setDestAddress('');
      setDestCity('');
      setDestState('');
      setDestZip('');
      setDeliveryDate(`${dayAfterDate.getUTCFullYear()}-${pad(dayAfterDate.getUTCMonth() + 1)}-${pad(dayAfterDate.getUTCDate())}`);
      setDeliveryTime('17:00');

      setRate('');
      setLoadedMiles('');
      setDeadheadMiles('0');
      setFuelExpense('');
      setDriverPay('');
      setOtherExpenses('');
      setSpecialInstructions('');
    }
  }, [isOpen, initialLoad?.id, operationalTimezone]);

  // Available trucks strictly filtered by selected client
  const availableTrucks = useMemo(() => {
    if (!clientId) return [];
    return trucks.filter((t) => t.client_id === clientId);
  }, [trucks, clientId]);

  // Available drivers strictly filtered by selected client
  const availableDrivers = useMemo(() => {
    if (!clientId) return [];
    return drivers.filter((d) => d.client_id === clientId);
  }, [drivers, clientId]);

  // Active operational team members (Admin, Dispatcher, Staff) for load assignment
  const activeTeamMembers = useMemo(() => {
    return teamMembers.filter(
      (m) =>
        (m.role === 'owner_admin' || m.role === 'dispatcher' || m.role === 'staff') &&
        (m as any).status !== 'inactive'
    );
  }, [teamMembers]);

  // Active broker details for preview
  const selectedBroker = useMemo(() => {
    return allBrokers.find((b) => b.id === brokerId) || null;
  }, [allBrokers, brokerId]);

  // Active driver details for contract calculation
  const selectedDriver = useMemo(() => {
    return drivers.find((d) => d.id === driverId) || null;
  }, [drivers, driverId]);

  // Active client details
  const selectedClient = useMemo(() => {
    return clients.find((c) => c.id === clientId) || null;
  }, [clients, clientId]);

  // When Client changes, enforce relationship integrity:
  // clear truck and driver if they do not belong to the newly selected client.
  const handleClientChange = (newClientId: string) => {
    setSubmitError(null);
    setClientId(newClientId);

    // Validate truck
    const validTrucksForNewClient = trucks.filter((t) => t.client_id === newClientId);
    if (!validTrucksForNewClient.some((t) => t.id === truckId)) {
      setTruckId(validTrucksForNewClient[0]?.id || '');
    }

    // Validate driver
    const validDriversForNewClient = drivers.filter((d) => d.client_id === newClientId);
    if (!validDriversForNewClient.some((d) => d.id === driverId)) {
      setDriverId(validDriversForNewClient[0]?.id || '');
    }
  };

  // When Truck changes, auto-suggest or link assigned driver if available
  const handleTruckChange = (newTruckId: string) => {
    setSubmitError(null);
    setTruckId(newTruckId);
    if (newTruckId) {
      const assignedDriver = availableDrivers.find((d) => (d as any).assigned_truck_id === newTruckId);
      if (assignedDriver) {
        setDriverId(assignedDriver.id);
      }
    }
  };

  // Numeric and Calculated Values
  const numericRate = Math.max(0, parseFloat(rate) || 0);
  const numericLoadedMiles = Math.max(0, parseFloat(loadedMiles) || 0);
  const numericDeadheadMiles = Math.max(0, parseFloat(deadheadMiles) || 0);
  const numericFuelExpense = Math.max(0, parseFloat(fuelExpense) || 0);
  const numericDriverPay = Math.max(0, parseFloat(driverPay) || 0);
  const numericOtherExpenses = Math.max(0, parseFloat(otherExpenses) || 0);
  const totalMiles = numericLoadedMiles + numericDeadheadMiles;

  // Auto-calculate driver pay from driver's contract terms
  const handleAutoCalculateDriverPay = () => {
    if (!selectedDriver) return;
    const computedPay = estimateDriverPay(
      selectedDriver.pay_type,
      selectedDriver.pay_rate,
      numericRate,
      numericLoadedMiles,
      numericDeadheadMiles
    );
    setDriverPay(String(computedPay));
  };

  // Auto-estimate fuel based on miles
  const handleAutoEstimateFuel = () => {
    const estimatedFuel = estimateFuelCost(totalMiles);
    setFuelExpense(String(estimatedFuel));
  };

  // LOAD-001: Sanitize exact currency input for Fuel Expense
  const handleFuelExpenseChange = (rawInput: string) => {
    // 1. Check for forbidden '-' BEFORE removing formatting characters.
    // Rejects negative values like "-100" and range expressions like "380-390" or "380 - 390".
    if (rawInput.includes('-')) {
      return;
    }

    // 2. Remove allowable currency formatting: currency symbols ($€£), commas, and whitespace
    const cleaned = rawInput.replace(/[$€£,\s]/g, '');

    // 3. Reject multiple decimal points (e.g. "380.50.20")
    if ((cleaned.match(/\./g) || []).length > 1) {
      return;
    }

    // 4. Keep only digits and at most one decimal point with up to 2 decimal places.
    // Allows empty string "" and intermediate typing state such as "385."
    if (cleaned !== '' && !/^\d*(\.\d{0,2})?$/.test(cleaned)) {
      return;
    }

    setFuelExpense(cleaned);
  };

  // Reliable Broker Matching from extracted broker info
  const matchBrokerFromExtraction = (extractedBroker: ExtractedBrokerInfo, brokerList: Broker[]): string | null => {
    if (!extractedBroker || !brokerList || brokerList.length === 0) return null;

    // 1. Match by MC number if provided
    if (extractedBroker.mc_number) {
      const cleanExtracted = extractedBroker.mc_number.replace(/\D/g, '');
      if (cleanExtracted.length >= 4) {
        const mcMatch = brokerList.find((b) => {
          if (!b.mc_number) return false;
          const cleanB = b.mc_number.replace(/\D/g, '');
          return cleanB === cleanExtracted;
        });
        if (mcMatch) return mcMatch.id;
      }
    }

    // 2. Match by DOT number if provided
    if (extractedBroker.dot_number) {
      const cleanExtracted = extractedBroker.dot_number.replace(/\D/g, '');
      if (cleanExtracted.length >= 4) {
        const dotMatch = brokerList.find((b) => {
          if (!b.dot_number) return false;
          const cleanB = b.dot_number.replace(/\D/g, '');
          return cleanB === cleanExtracted;
        });
        if (dotMatch) return dotMatch.id;
      }
    }

    // 3. Match by Company Name (sufficiently reliable match)
    if (extractedBroker.company_name && extractedBroker.company_name.trim().length >= 3) {
      const target = extractedBroker.company_name.toLowerCase().trim();
      const exactMatch = brokerList.find((b) => b.company_name.toLowerCase().trim() === target);
      if (exactMatch) return exactMatch.id;

      // Reliable partial match with minimum length threshold
      const partialMatch = brokerList.find((b) => {
        const bName = b.company_name.toLowerCase().trim();
        return (target.length >= 5 && bName.includes(target)) || (bName.length >= 5 && target.includes(bName));
      });
      if (partialMatch) return partialMatch.id;
    }

    return null;
  };

  // Handle Rate Con File Selection and AI Extraction
  const handleRateConFileSelected = async (file: File) => {
    setExtractionError(null);

    // A. PDF Validation
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setExtractionError('Please select a valid Rate Confirmation PDF file (.pdf).');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setExtractionError('File size exceeds the 15 MB limit. Please select a smaller PDF.');
      return;
    }

    // Capture snapshot of current form state before applying extraction if not already stored
    if (!formSnapshotBeforeExtraction) {
      setFormSnapshotBeforeExtraction({
        loadNumber,
        brokerId,
        pipelineStatus,
        equipmentType,
        commodity,
        weightLbs,
        originFacilityName,
        originAddress,
        originCity,
        originState,
        originZip,
        pickupDate,
        pickupTime,
        destFacilityName,
        destAddress,
        destCity,
        destState,
        destZip,
        deliveryDate,
        deliveryTime,
        rate,
        loadedMiles,
        deadheadMiles,
        fuelExpense,
        driverPay,
        otherExpenses,
        specialInstructions,
      });
    }

    setIsExtracting(true);
    setRateConFile(file);

    try {
      // Call EXISTING P0.2 extraction service
      const result = await extractionService.extractRateConfirmation({ file, organizationId });
      setExtractionResult(result);

      let populatedCount = 0;

      // 1. Load Number
      const extractedLoadNum =
        result.load_info?.load_number ||
        (result as any).load_number ||
        '';
      if (extractedLoadNum && extractedLoadNum.trim()) {
        setLoadNumber(extractedLoadNum.trim().toUpperCase());
        populatedCount++;
      }

      // 2. Rate (total carrier compensation)
      const extractedRate =
        result.load_info?.total_carrier_compensation ||
        result.financial_breakdown?.total_carrier_compensation ||
        result.load_info?.rate ||
        0;
      if (extractedRate > 0) {
        setRate(String(extractedRate));
        populatedCount++;
      }

      // 3. Loaded Miles
      const extractedMiles =
        result.load_info?.mileage ||
        (result as any).mileage ||
        (result.financial_breakdown as any)?.mileage ||
        0;
      if (extractedMiles > 0) {
        setLoadedMiles(String(extractedMiles));
        populatedCount++;
      }

      // 4. Equipment Type
      const rawEquipment = result.load_info?.equipment_type || (result as any).equipment_type;
      if (rawEquipment) {
        const normalizedEq = normalizeEquipmentType(rawEquipment);
        setEquipmentType(normalizedEq);
        populatedCount++;
      }

      // 5. Commodity
      const extractedCommodity = result.load_info?.commodity || (result as any).commodity;
      if (extractedCommodity && extractedCommodity.trim()) {
        setCommodity(extractedCommodity.trim());
        populatedCount++;
      }

      // 6. Weight
      const extractedWeight =
        result.load_info?.weight_lbs ||
        (result as any).weight_lbs ||
        (result as any).weight ||
        0;
      if (extractedWeight > 0) {
        setWeightLbs(String(extractedWeight));
        populatedCount++;
      }

      // 7. Special Instructions & Reference / PO #
      const instructionsParts: string[] = [];
      const refNum = result.load_info?.reference_number || (result as any).reference_number;
      if (refNum && String(refNum).trim()) {
        instructionsParts.push(`Broker Ref / PO #: ${String(refNum).trim()}`);
      }
      const rawInstructions =
        result.load_info?.special_instructions ||
        (result as any).special_instructions;
      if (rawInstructions && String(rawInstructions).trim()) {
        instructionsParts.push(String(rawInstructions).trim());
      }
      if (instructionsParts.length > 0) {
        setSpecialInstructions(instructionsParts.join('\n\n'));
        populatedCount++;
      }

      // 8. Origin Facility, Address, City, State, Zip, Pickup Datetime
      const originFac = result.origin?.facility_name || result.stops?.[0]?.facility_name;
      if (originFac && originFac.trim()) {
        setOriginFacilityName(originFac.trim());
        populatedCount++;
      }

      const originAddr = result.origin?.address || result.stops?.[0]?.address;
      if (originAddr && originAddr.trim()) {
        setOriginAddress(originAddr.trim());
        populatedCount++;
      }

      const originC = result.origin?.city || result.stops?.[0]?.city;
      if (originC && originC.trim()) {
        setOriginCity(originC.trim());
        populatedCount++;
      }

      const originS = (result.origin?.state || result.stops?.[0]?.state || '').trim().toUpperCase();
      if (originS && isValidUsState(originS)) {
        setOriginState(originS);
        populatedCount++;
      }

      const originZ = result.origin?.zip || result.stops?.[0]?.zip;
      if (originZ && originZ.trim()) {
        setOriginZip(originZ.trim());
        populatedCount++;
      }

      const rawPickup =
        result.origin?.pickup_datetime ||
        result.origin?.date_string ||
        result.stops?.[0]?.datetime_iso ||
        result.stops?.[0]?.date_string;
      if (rawPickup) {
        const parsedPickup = parseDateAndTimeToInputs(rawPickup, operationalTimezone);
        if (parsedPickup.date) {
          setPickupDate(parsedPickup.date);
          if (parsedPickup.time) {
            setPickupTime(parsedPickup.time);
          }
          populatedCount++;
        }
      }

      // 9. Destination Facility, Address, City, State, Zip, Delivery Datetime
      const destFac = result.destination?.facility_name || result.stops?.[1]?.facility_name;
      if (destFac && destFac.trim()) {
        setDestFacilityName(destFac.trim());
        populatedCount++;
      }

      const destAddr = result.destination?.address || result.stops?.[1]?.address;
      if (destAddr && destAddr.trim()) {
        setDestAddress(destAddr.trim());
        populatedCount++;
      }

      const destC = result.destination?.city || result.stops?.[1]?.city;
      if (destC && destC.trim()) {
        setDestCity(destC.trim());
        populatedCount++;
      }

      const destS = (result.destination?.state || result.stops?.[1]?.state || '').trim().toUpperCase();
      if (destS && isValidUsState(destS)) {
        setDestState(destS);
        populatedCount++;
      }

      const destZ = result.destination?.zip || result.stops?.[1]?.zip;
      if (destZ && destZ.trim()) {
        setDestZip(destZ.trim());
        populatedCount++;
      }

      const rawDelivery =
        result.destination?.delivery_datetime ||
        result.destination?.date_string ||
        result.stops?.[1]?.datetime_iso ||
        result.stops?.[1]?.date_string;
      if (rawDelivery) {
        const parsedDelivery = parseDateAndTimeToInputs(rawDelivery, operationalTimezone);
        if (parsedDelivery.date) {
          setDeliveryDate(parsedDelivery.date);
          if (parsedDelivery.time) {
            setDeliveryTime(parsedDelivery.time);
          }
          populatedCount++;
        }
      }

      // 10. Broker Matching
      if (result.broker) {
        const matchedBrokerId = matchBrokerFromExtraction(result.broker, allBrokers);
        if (matchedBrokerId) {
          setBrokerId(matchedBrokerId);
          setUnmatchedBroker(null);
          populatedCount++;
        } else {
          // Immediately set brokerId(''); do NOT select brokers[0]
          // Preserve the extracted Broker information for the UI
          setBrokerId('');
          setUnmatchedBroker(result.broker);
        }
      }

      // 11. Pipeline status: default to 'booked' when importing a rate con
      setPipelineStatus('booked');

      // 12. Update estimated fuel expense if miles were extracted
      if (extractedMiles > 0) {
        const estimatedFuel = estimateFuelCost(extractedMiles + (parseFloat(deadheadMiles) || 0));
        setFuelExpense(String(estimatedFuel));
      }

      // IMPORTANT: Never overwrite or clear clientId. Preserved entirely for explicit dispatcher selection.

      // Success notice with confidence & field count
      const overallConfidence = result.confidence_scores?.overall || 0;
      setExtractionNotice({
        fileName: file.name,
        confidence: overallConfidence,
        fieldsCount: populatedCount,
      });

      // Clear previous validation errors
      setFormErrors({});
    } catch (err: any) {
      console.error('Rate Con extraction error:', err);
      const msg = err?.message || 'Failed to extract data from Rate Confirmation PDF. Please verify the document or fill fields manually.';
      setExtractionError(msg);
      setRateConFile(null);
    } finally {
      setIsExtracting(false);
    }
  };

  // Clear / Undo Extraction handler
  const handleClearExtraction = () => {
    if (formSnapshotBeforeExtraction) {
      setLoadNumber(formSnapshotBeforeExtraction.loadNumber);
      setBrokerId(formSnapshotBeforeExtraction.brokerId);
      setPipelineStatus(formSnapshotBeforeExtraction.pipelineStatus);
      setEquipmentType(formSnapshotBeforeExtraction.equipmentType);
      setCommodity(formSnapshotBeforeExtraction.commodity);
      setWeightLbs(formSnapshotBeforeExtraction.weightLbs);
      setOriginFacilityName(formSnapshotBeforeExtraction.originFacilityName);
      setOriginAddress(formSnapshotBeforeExtraction.originAddress);
      setOriginCity(formSnapshotBeforeExtraction.originCity);
      setOriginState(formSnapshotBeforeExtraction.originState);
      setOriginZip(formSnapshotBeforeExtraction.originZip);
      setPickupDate(formSnapshotBeforeExtraction.pickupDate);
      setPickupTime(formSnapshotBeforeExtraction.pickupTime);
      setDestFacilityName(formSnapshotBeforeExtraction.destFacilityName);
      setDestAddress(formSnapshotBeforeExtraction.destAddress);
      setDestCity(formSnapshotBeforeExtraction.destCity);
      setDestState(formSnapshotBeforeExtraction.destState);
      setDestZip(formSnapshotBeforeExtraction.destZip);
      setDeliveryDate(formSnapshotBeforeExtraction.deliveryDate);
      setDeliveryTime(formSnapshotBeforeExtraction.deliveryTime);
      setRate(formSnapshotBeforeExtraction.rate);
      setLoadedMiles(formSnapshotBeforeExtraction.loadedMiles);
      setDeadheadMiles(formSnapshotBeforeExtraction.deadheadMiles);
      setFuelExpense(formSnapshotBeforeExtraction.fuelExpense);
      setDriverPay(formSnapshotBeforeExtraction.driverPay);
      setOtherExpenses(formSnapshotBeforeExtraction.otherExpenses);
      setSpecialInstructions(formSnapshotBeforeExtraction.specialInstructions);
    }
    setRateConFile(null);
    setExtractionResult(null);
    setExtractionError(null);
    setExtractionNotice(null);
    setFormSnapshotBeforeExtraction(null);
    setUnmatchedBroker(null);
    setIsCreatingBroker(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Add & Link newly extracted broker to CRM and current load
  const handleAddAndLinkBroker = async () => {
    if (!unmatchedBroker || isCreatingBroker) return;
    setIsCreatingBroker(true);
    setSubmitError(null);

    try {
      const targetOrgId = organizationId || 'demo-organization-default';
      const createdBroker = await brokerService.createBroker(targetOrgId, {
        company_name: unmatchedBroker.company_name.trim(),
        mc_number: unmatchedBroker.mc_number || null,
        dot_number: unmatchedBroker.dot_number || null,
        contact_name: unmatchedBroker.contact_name || null,
        contact_email: unmatchedBroker.contact_email || null,
        contact_phone: unmatchedBroker.contact_phone || null,
        payment_terms_days: unmatchedBroker.payment_terms_days || 30,
        credit_status: 'approved',
        notes: 'Created via RateCon extraction auto-link',
      });

      // Add to local brokers list so it is immediately available in dropdown
      setLocalBrokers((prev) => [...prev, createdBroker]);
      // Link the new broker ID to this load form
      setBrokerId(createdBroker.id);
      // Clear unmatched state
      setUnmatchedBroker(null);
    } catch (err: any) {
      console.error('Failed to create and link broker:', err);
      setSubmitError(err?.message || 'Failed to add broker. Please select an existing broker or try again.');
    } finally {
      setIsCreatingBroker(false);
    }
  };

  // Dismiss unmatched broker warning and allow manual selection of existing broker
  const handleSelectExistingBroker = () => {
    setUnmatchedBroker(null);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleRateConFileSelected(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleRateConFileSelected(file);
    }
  };

  // Validation before submit
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!loadNumber.trim()) {
      errors.loadNumber = 'Load number is required.';
    }
    if (!clientId) {
      errors.clientId = 'Client selection is required.';
    }
    if (!originCity.trim()) {
      errors.originCity = 'Origin city is required.';
    }
    if (!originState.trim() || !isValidUsState(originState)) {
      errors.originState = 'Valid 2-letter state required.';
    }
    if (!destCity.trim()) {
      errors.destCity = 'Destination city is required.';
    }
    if (!destState.trim() || !isValidUsState(destState)) {
      errors.destState = 'Valid 2-letter state required.';
    }

    if (pickupDate && deliveryDate) {
      const schedule = deriveLoadScheduleFromInputs({
        pickupDate,
        pickupTime,
        deliveryDate,
        deliveryTime,
      }, operationalTimezone);
      if (!schedule.isValid && schedule.validationError) {
        errors.deliveryDate = schedule.validationError;
      }
    }

    if (numericRate <= 0) {
      errors.rate = 'Gross rate must be greater than $0.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validateForm()) return;

    // Directly derive pickup and delivery ISO timestamps from the active UI selector state
    const schedule = deriveLoadScheduleFromInputs({
      pickupDate,
      pickupTime,
      deliveryDate,
      deliveryTime,
    }, operationalTimezone);

    const payload: CreateLoadInput = {
      load_number: loadNumber.trim().toUpperCase(),
      client_id: clientId || null,
      broker_id: brokerId || null,
      truck_id: truckId || null,
      driver_id: driverId || null,
      assigned_dispatcher_id: assignedDispatcherId || null,
      pipeline_status: pipelineStatus,
      equipment_type: equipmentType,
      commodity: commodity.trim() || null,
      weight_lbs: weightLbs ? parseFloat(weightLbs) : null,
      origin_facility_name: originFacilityName.trim() || null,
      origin_address: originAddress.trim() || null,
      origin_city: originCity.trim(),
      origin_state: originState.trim().toUpperCase(),
      origin_zip: originZip.trim() || null,
      pickup_datetime: schedule.pickup_datetime,
      dest_facility_name: destFacilityName.trim() || null,
      dest_address: destAddress.trim() || null,
      dest_city: destCity.trim(),
      dest_state: destState.trim().toUpperCase(),
      dest_zip: destZip.trim() || null,
      delivery_datetime: schedule.delivery_datetime,
      rate: numericRate,
      loaded_miles: numericLoadedMiles,
      deadhead_miles: numericDeadheadMiles,
      fuel_expense: numericFuelExpense,
      driver_pay: numericDriverPay,
      other_expenses: numericOtherExpenses,
      special_instructions: specialInstructions.trim() || null,
    };

    setIsSubmitting(true);
    try {
      await onSave(payload, rateConFile);
    } catch (err: any) {
      console.error('LoadModal save error:', err);
      setSubmitError(err?.message || 'Failed to save load. Please check assignments and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSaving || isSubmitting;

  return (
    <Modal
      id="load-modal"
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Load ${initialLoad?.load_number}` : 'Create Dispatch Load'}
      subtitle={
        isEditing
          ? 'Update dispatch assignments, rate con terms, or schedule'
          : 'Book new load with carrier assignment, broker terms, and live profitability'
      }
      maxWidth="3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6 text-xs text-slate-200">
        {/* Rate Con PDF Upload & Auto-Fill Section (Book Load AI Extraction) */}
        <div
          id="ratecon-pdf-upload-card"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`p-3.5 rounded-xl border transition-all duration-200 ${
            isDragOver
              ? 'bg-indigo-950/50 border-indigo-500 ring-2 ring-indigo-500/30'
              : 'bg-slate-900/80 border-slate-800/90 hover:border-slate-700/80'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-950/80 border border-indigo-700/50 flex items-center justify-center shrink-0 mt-0.5 text-indigo-400">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100 text-xs">Rate Confirmation PDF</span>
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 font-medium">
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    AI Auto-Fill
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Upload a broker rate confirmation PDF to extract load #, gross pay, route, dates, and terms.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <input
                ref={fileInputRef}
                id="ratecon-pdf-file-input"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileInputChange}
                className="hidden"
                disabled={isBusy || isExtracting}
              />

              {extractionNotice && (
                <button
                  id="ratecon-clear-extraction-btn"
                  type="button"
                  onClick={handleClearExtraction}
                  disabled={isBusy || isExtracting}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                  title="Undo extraction and restore form fields"
                >
                  <X className="w-3.5 h-3.5 text-slate-400" />
                  <span>Undo / Clear</span>
                </button>
              )}

              <button
                id="ratecon-upload-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy || isExtracting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                {isExtracting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Extracting PDF...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5 text-indigo-200" />
                    <span>{rateConFile ? 'Replace PDF' : 'Upload Rate Con (PDF)'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Extraction Error Notice */}
          {extractionError && (
            <div
              id="ratecon-extraction-error-banner"
              className="mt-3 flex items-start gap-2 p-2.5 bg-rose-950/50 border border-rose-800/70 rounded-lg text-rose-200 text-[11px] animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold text-rose-300">Extraction Notice: </span>
                <span>{extractionError}</span>
              </div>
            </div>
          )}

          {/* Extraction Success Notice */}
          {extractionNotice && (
            <div
              id="ratecon-extraction-success-banner"
              className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-emerald-200 text-[11px] animate-in fade-in"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold text-emerald-300">
                    Rate Con extracted — review the populated fields before creating the load.
                  </span>
                  <span className="text-emerald-400/90 ml-1.5 text-[10px]">
                    ({extractionNotice.fileName})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {extractionNotice.confidence > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/60 border border-emerald-700/50 text-emerald-300">
                    {extractionNotice.confidence}% AI Confidence
                  </span>
                )}
                {extractionNotice.fieldsCount > 0 && (
                  <span className="text-slate-400 text-[10px]">
                    {extractionNotice.fieldsCount} fields populated
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error Alert Banner */}
        {submitError && (
          <div
            id="load-modal-error-banner"
            className="flex items-start gap-2.5 p-3.5 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-200 animate-in fade-in duration-200"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-rose-300 text-xs">Assignment or Save Error</p>
              <p className="text-[11px] text-rose-200/90 mt-0.5 leading-relaxed">{submitError}</p>
            </div>
          </div>
        )}

        {/* Top Header Bar: Load # & Pipeline Status */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/90 grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-start">
          <div className="sm:col-span-4">
            <label className="block text-slate-400 font-semibold mb-1">
              Load Number <span className="text-rose-400">*</span>
            </label>
            <input
              id="load-number-input"
              type="text"
              required
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value.toUpperCase())}
              placeholder="e.g. LD-2026-1001"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono font-bold focus:outline-none focus:border-indigo-500"
            />
            {formErrors.loadNumber && (
              <p className="text-rose-400 text-[11px] mt-1">{formErrors.loadNumber}</p>
            )}
          </div>

          <div className="sm:col-span-8">
            <label className="block text-slate-400 font-semibold mb-1">
              Pipeline Status
            </label>
            <select
              id="load-status-select"
              value={pipelineStatus}
              disabled={availableStatusOptions.length <= 1}
              onChange={(e) => setPipelineStatus(e.target.value as PipelineStatus)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {availableStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SECTION 1: ASSIGNMENT (Client -> Truck -> Driver) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            <Building2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>1. Carrier Fleet & Unit Assignment</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Client Selection */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Client / Carrier <span className="text-rose-400">*</span>
              </label>
              <select
                id="load-client-select"
                required
                value={clientId}
                onChange={(e) => handleClientChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="" disabled>
                  Select Client Carrier...
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name} ({c.client_type === 'owner_operator' ? 'Owner-Op' : 'Fleet'})
                  </option>
                ))}
              </select>
              {formErrors.clientId && (
                <p className="text-rose-400 text-[11px] mt-1">{formErrors.clientId}</p>
              )}
            </div>

            {/* Truck Selection (filtered by Client) */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Assigned Truck
              </label>
              <select
                id="load-truck-select"
                value={truckId}
                onChange={(e) => handleTruckChange(e.target.value)}
                disabled={!clientId}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
              >
                <option value="">(No power unit assigned)</option>
                {availableTrucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    Truck #{t.truck_number} ({t.equipment_type.replace('_', ' ')})
                  </option>
                ))}
              </select>
              {clientId && availableTrucks.length === 0 && (
                <p className="text-amber-400/80 text-[10px] mt-1">No trucks registered for this client</p>
              )}
            </div>

            {/* Driver Selection (filtered by Client) */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Assigned Driver
              </label>
              <select
                id="load-driver-select"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                disabled={!clientId}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
              >
                <option value="">(No driver assigned)</option>
                {availableDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name} ({d.pay_type === 'percentage_gross' ? `${d.pay_rate}% gross` : d.pay_type === 'per_mile' ? `$${d.pay_rate}/mi` : `$${d.pay_rate} flat`})
                  </option>
                ))}
              </select>
              {clientId && availableDrivers.length === 0 && (
                <p className="text-amber-400/80 text-[10px] mt-1">No drivers registered for this client</p>
              )}
            </div>

            {/* Team Member Assignment Selection */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Assigned To
              </label>
              <select
                id="load-dispatcher-select"
                value={assignedDispatcherId}
                onChange={(e) => setAssignedDispatcherId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="">(No team member / Unassigned)</option>
                {activeTeamMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} — {m.role === 'owner_admin' ? 'Admin' : m.role === 'dispatcher' ? 'Dispatcher' : 'Staff'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 2: BROKER */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span>2. Freight Broker / Customer</span>
          </div>

          {/* Unmatched Broker Inline Confirmation Area */}
          {unmatchedBroker && (
            <div
              id="unmatched-broker-card"
              className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-300">Broker not found in CRM</div>
                  <div className="font-bold text-slate-100 text-sm mt-0.5">{unmatchedBroker.company_name}</div>
                  <div className="text-[11px] text-amber-200/80 mt-0.5">
                    MC: {unmatchedBroker.mc_number || 'N/A'}{unmatchedBroker.dot_number ? ` • DOT: ${unmatchedBroker.dot_number}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  id="add-and-link-broker-btn"
                  type="button"
                  disabled={isCreatingBroker}
                  onClick={handleAddAndLinkBroker}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isCreatingBroker ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Adding Broker...</span>
                    </>
                  ) : (
                    <span>Add & Link Broker</span>
                  )}
                </button>
                <button
                  id="select-existing-broker-btn"
                  type="button"
                  disabled={isCreatingBroker}
                  onClick={handleSelectExistingBroker}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 hover:text-white text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
                >
                  Select Existing
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Brokerage Firm
              </label>
              <select
                id="load-broker-select"
                value={brokerId}
                onChange={(e) => {
                  setBrokerId(e.target.value);
                  if (e.target.value) {
                    setUnmatchedBroker(null);
                  }
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="">(No broker linked)</option>
                {allBrokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.company_name} {b.mc_number ? `(MC-${b.mc_number})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Broker Contact & Credit Snapshot */}
            {selectedBroker ? (
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[11px] flex flex-col justify-center space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{selectedBroker.company_name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                    {selectedBroker.credit_status.replace('_', ' ')} • {selectedBroker.payment_terms_days}d Net
                  </span>
                </div>
                <div className="text-slate-400 flex items-center gap-3">
                  <span>Contact: <strong className="text-slate-300">{selectedBroker.contact_name || 'Dispatch Desk'}</strong></span>
                  {selectedBroker.contact_phone && <span>{selectedBroker.contact_phone}</span>}
                </div>
              </div>
            ) : (
              <div className="bg-slate-950/40 border border-dashed border-slate-800 rounded-lg p-2.5 flex items-center text-slate-500 text-[11px]">
                Select a broker to inspect credit terms and contact details
              </div>
            )}
          </div>
        </div>

        {/* SECTION 3 & 4: PICKUP & DELIVERY (LANES) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pickup */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-800/80 text-emerald-400 font-bold uppercase tracking-wider text-[11px]">
              <MapPin className="w-3.5 h-3.5" />
              <span>3. Shipper / Origin (Pickup)</span>
            </div>

            {/* Row 0: Facility Name | Street Address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Facility / Shipper Name</label>
                <input
                  id="origin-facility-input"
                  type="text"
                  placeholder="e.g. Central Logistics Center"
                  value={originFacilityName}
                  onChange={(e) => setOriginFacilityName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Street Address</label>
                <input
                  id="origin-address-input"
                  type="text"
                  placeholder="e.g. 1000 Industrial Pkwy"
                  value={originAddress}
                  onChange={(e) => setOriginAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Row 1: City | State | ZIP */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-6">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">
                  City <span className="text-rose-400">*</span>
                </label>
                <input
                  id="origin-city-input"
                  type="text"
                  required
                  placeholder="e.g. Chicago"
                  value={originCity}
                  onChange={(e) => setOriginCity(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                {formErrors.originCity && (
                  <p className="text-rose-400 text-[10px] mt-0.5">{formErrors.originCity}</p>
                )}
              </div>

              <div className="sm:col-span-3">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">
                  State <span className="text-rose-400">*</span>
                </label>
                <select
                  id="origin-state-select"
                  value={originState}
                  onChange={(e) => setOriginState(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">State...</option>
                  {US_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">ZIP Code</label>
                <input
                  id="origin-zip-input"
                  type="text"
                  placeholder="e.g. 60601"
                  value={originZip}
                  onChange={(e) => setOriginZip(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Row 2: Date | Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="pickup-date-input" className="block text-slate-400 text-[11px] mb-1 font-medium">
                  Pickup Date
                </label>
                <input
                  id="pickup-date-input"
                  type="date"
                  value={pickupDate}
                  onChange={(e) => {
                    setPickupDate(e.target.value);
                    setSubmitError(null);
                    if (formErrors.deliveryDate) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.deliveryDate;
                        return next;
                      });
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 focus:bg-slate-900 border border-slate-700 hover:border-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 rounded-lg text-slate-100 font-mono text-xs focus:outline-none [color-scheme:dark] cursor-pointer transition-all shadow-xs"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Pickup Time</label>
                <select
                  id="pickup-time-select"
                  value={pickupTime}
                  onChange={(e) => {
                    setPickupTime(e.target.value);
                    setSubmitError(null);
                    if (formErrors.deliveryDate) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.deliveryDate;
                        return next;
                      });
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-700 hover:border-slate-600 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500 cursor-pointer transition-colors"
                >
                  {!TIME_OPTIONS.some((opt) => opt.value === pickupTime) && pickupTime && (
                    <option value={pickupTime}>{formatTimeOptionLabel(pickupTime)}</option>
                  )}
                  {TIME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Delivery */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-slate-800/80 text-teal-400 font-bold uppercase tracking-wider text-[11px]">
              <MapPin className="w-3.5 h-3.5" />
              <span>4. Receiver / Destination (Delivery)</span>
            </div>

            {/* Row 0: Facility Name | Street Address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Facility / Receiver Name</label>
                <input
                  id="dest-facility-input"
                  type="text"
                  placeholder="e.g. Metro Freight Terminal"
                  value={destFacilityName}
                  onChange={(e) => setDestFacilityName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Street Address</label>
                <input
                  id="dest-address-input"
                  type="text"
                  placeholder="e.g. 2500 Commerce Way"
                  value={destAddress}
                  onChange={(e) => setDestAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Row 1: City | State | ZIP */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-6">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">
                  City <span className="text-rose-400">*</span>
                </label>
                <input
                  id="dest-city-input"
                  type="text"
                  required
                  placeholder="e.g. Houston"
                  value={destCity}
                  onChange={(e) => setDestCity(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                {formErrors.destCity && (
                  <p className="text-rose-400 text-[10px] mt-0.5">{formErrors.destCity}</p>
                )}
              </div>

              <div className="sm:col-span-3">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">
                  State <span className="text-rose-400">*</span>
                </label>
                <select
                  id="dest-state-select"
                  value={destState}
                  onChange={(e) => setDestState(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">State...</option>
                  {US_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">ZIP Code</label>
                <input
                  id="dest-zip-input"
                  type="text"
                  placeholder="e.g. 77001"
                  value={destZip}
                  onChange={(e) => setDestZip(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Row 2: Date | Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="delivery-date-input" className="block text-slate-400 text-[11px] mb-1 font-medium">
                  Delivery Date
                </label>
                <input
                  id="delivery-date-input"
                  type="date"
                  min={pickupDate || undefined}
                  value={deliveryDate}
                  onChange={(e) => {
                    setDeliveryDate(e.target.value);
                    setSubmitError(null);
                    if (formErrors.deliveryDate) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.deliveryDate;
                        return next;
                      });
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 focus:bg-slate-900 border rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:ring-1 [color-scheme:dark] cursor-pointer transition-all shadow-xs ${
                    formErrors.deliveryDate
                      ? 'border-rose-500 ring-1 ring-rose-500/50 focus:border-rose-500 focus:ring-rose-500/50'
                      : 'border-slate-700 hover:border-slate-500 focus:border-indigo-500 focus:ring-indigo-500/40'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1 font-medium">Delivery Time</label>
                <select
                  id="delivery-time-select"
                  value={deliveryTime}
                  onChange={(e) => {
                    setDeliveryTime(e.target.value);
                    setSubmitError(null);
                    if (formErrors.deliveryDate) {
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        delete next.deliveryDate;
                        return next;
                      });
                    }
                  }}
                  className={`w-full px-2.5 py-1.5 bg-slate-900 hover:bg-slate-850 border rounded-lg text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500 cursor-pointer transition-colors ${
                    formErrors.deliveryDate
                      ? 'border-rose-500 ring-1 ring-rose-500/50'
                      : 'border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {!TIME_OPTIONS.some((opt) => opt.value === deliveryTime) && deliveryTime && (
                    <option value={deliveryTime}>{formatTimeOptionLabel(deliveryTime)}</option>
                  )}
                  {TIME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {formErrors.deliveryDate && (
              <p id="delivery-date-error" className="text-rose-400 text-[11px] mt-1 flex items-center gap-1.5 font-medium bg-rose-950/40 p-2 rounded-lg border border-rose-800/60 animate-in fade-in duration-200">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                <span>{formErrors.deliveryDate}</span>
              </p>
            )}
          </div>
        </div>

        {/* SECTION 5: FREIGHT SPECS & MILEAGE */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            <PackageCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>5. Freight Equipment & Odometer Specs</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Equipment</label>
              <select
                id="load-equipment-select"
                value={equipmentType}
                onChange={(e) => setEquipmentType(e.target.value as EquipmentType)}
                className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {EQUIPMENT_TYPE_OPTIONS.map((eq) => (
                  <option key={eq.value} value={eq.value}>
                    {eq.shortLabel}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2 sm:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Commodity / Goods</label>
              <input
                id="load-commodity-input"
                type="text"
                placeholder="e.g. Palletized Dry Goods"
                value={commodity}
                onChange={(e) => setCommodity(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Weight (lbs)</label>
              <input
                id="load-weight-input"
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 40000"
                value={weightLbs}
                onChange={(e) => setWeightLbs(e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Loaded Mi</label>
                <input
                  id="load-loaded-miles-input"
                  type="number"
                  min="0"
                  value={loadedMiles}
                  onChange={(e) => setLoadedMiles(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Deadhead</label>
                <input
                  id="load-deadhead-miles-input"
                  type="number"
                  min="0"
                  value={deadheadMiles}
                  onChange={(e) => setDeadheadMiles(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 6: FINANCIAL INPUTS & LIVE PROFITABILITY */}
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800">
            <div className="flex items-center gap-2 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>6. Rate & Financial Dispatch Inputs</span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Total Trip Miles: <strong className="text-slate-200">{totalMiles} mi</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Gross Rate ($) <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                <input
                  id="load-rate-input"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="w-full pl-6 pr-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono font-bold focus:outline-none focus:border-indigo-500"
                />
              </div>
              {formErrors.rate && (
                <p className="text-rose-400 text-[10px] mt-0.5">{formErrors.rate}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-300 font-medium">Fuel Expense ($)</label>
                <button
                  type="button"
                  onClick={handleAutoEstimateFuel}
                  title="Estimate fuel at 6.5 MPG @ $3.85/gal"
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 cursor-pointer"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Auto
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                <input
                  id="load-fuel-expense-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={fuelExpense}
                  onChange={(e) => handleFuelExpenseChange(e.target.value)}
                  className="w-full pl-6 pr-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-300 font-medium">Driver Pay ($)</label>
                {selectedDriver && (
                  <button
                    type="button"
                    onClick={handleAutoCalculateDriverPay}
                    title="Auto-calculate driver pay from contract terms"
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Calculator className="w-2.5 h-2.5" />
                    Contract
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                <input
                  id="load-driver-pay-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={driverPay}
                  onChange={(e) => setDriverPay(e.target.value)}
                  className="w-full pl-6 pr-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Other Costs ($)</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                <input
                  id="load-other-expenses-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Lumper / Tolls"
                  value={otherExpenses}
                  onChange={(e) => setOtherExpenses(e.target.value)}
                  className="w-full pl-6 pr-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Deterministic Live Profitability Preview Card */}
          <div className="pt-2">
            <LoadProfitabilityCard
              rate={numericRate}
              loadedMiles={numericLoadedMiles}
              deadheadMiles={numericDeadheadMiles}
              fuelExpense={numericFuelExpense}
              driverPay={numericDriverPay}
              otherExpenses={numericOtherExpenses}
            />
          </div>
        </div>

        {/* SECTION 7: SPECIAL INSTRUCTIONS */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span>7. Special Instructions & Check Call Rules</span>
          </div>
          <textarea
            id="load-special-instructions-input"
            rows={2}
            placeholder="e.g. Standard appointment window. Call dispatch upon arrival and departure. Verify seal number on BOL."
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600 resize-none font-sans"
          />
        </div>

        {/* Footer Actions & Error Banner */}
        <div className="sticky bottom-0 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 px-5 sm:px-6 py-3.5 bg-slate-900/95 border-t border-slate-800 z-10 backdrop-blur-xs space-y-3 shadow-lg">
          {submitError && (
            <div
              id="load-modal-footer-error-banner"
              className="flex items-start gap-2.5 p-3.5 bg-rose-950/80 border border-rose-700 rounded-xl text-rose-200 animate-in fade-in duration-200"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-rose-300 text-xs">Assignment or Save Error</p>
                <p className="text-[11px] text-rose-200 mt-0.5 leading-relaxed">{submitError}</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              id="save-load-btn"
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {isBusy ? (
                <span>Saving Load...</span>
              ) : (
                <span>{isEditing ? 'Save Changes' : 'Confirm & Book Load'}</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
