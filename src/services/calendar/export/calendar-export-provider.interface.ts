import type {
  CalendarContainer,
  CalendarEventItem,
  CalendarOwnershipContext,
} from '../calendar.interface.js';

export interface CalendarExportParams {
  calendar: CalendarContainer;
  events: CalendarEventItem[];
  title?: string;
  academicYear?: string | null;
  countryName?: string | null;
  requesterContext: CalendarOwnershipContext;
}

export interface CalendarExportResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
  metadata: Record<string, string>;
}

export interface CalendarExportProvider {
  readonly supportedFormat: 'PDF' | 'ICS' | 'XLSX' | 'CSV';
  exportCalendar(params: CalendarExportParams): Promise<CalendarExportResult>;
}
