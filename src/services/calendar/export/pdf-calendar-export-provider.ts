import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type {
  CalendarExportProvider,
  CalendarExportParams,
  CalendarExportResult,
} from './calendar-export-provider.interface.js';

export class PdfCalendarExportProvider implements CalendarExportProvider {
  readonly supportedFormat = 'PDF' as const;

  async exportCalendar(params: CalendarExportParams): Promise<CalendarExportResult> {
    const { calendar, events, title, academicYear, countryName } = params;

    const pdfDoc = await PDFDocument.create();
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Helper to start a new page
    const checkPageBreak = (neededHeight: number) => {
      if (y - neededHeight < margin + 40) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        return true;
      }
      return false;
    };

    // 1. Header Banner
    const docTitle = title || calendar.name || 'Academic Calendar';
    page.drawText(docTitle, {
      x: margin,
      y,
      size: 20,
      font: helveticaBold,
      color: rgb(0.08, 0.22, 0.38), // dark navy
    });
    y -= 24;

    // Subtitle / Scope details
    const subtitleParts: string[] = [];
    if (academicYear || calendar.academicYear) {
      subtitleParts.push(`Academic Year: ${academicYear || calendar.academicYear}`);
    }
    if (countryName) {
      subtitleParts.push(`Country: ${countryName}`);
    }
    subtitleParts.push(`Scope: ${calendar.calendarScope}`);
    subtitleParts.push(`Generated: ${new Date().toISOString().split('T')[0]}`);

    page.drawText(subtitleParts.join('  |  '), {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: rgb(0.4, 0.45, 0.5),
    });
    y -= 15;

    // Horizontal divider
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 1,
      color: rgb(0.85, 0.88, 0.92),
    });
    y -= 25;

    // 2. Separate events into Official and Personal
    const officialEvents = events.filter((e) => e.sourceType === 'OFFICIAL');
    const personalEvents = events.filter((e) => e.sourceType !== 'OFFICIAL');

    const renderEventSection = (sectionTitle: string, sectionEvents: typeof events) => {
      checkPageBreak(50);

      // Section Header
      page.drawText(`${sectionTitle} (${sectionEvents.length})`, {
        x: margin,
        y,
        size: 14,
        font: helveticaBold,
        color: rgb(0.12, 0.15, 0.18),
      });
      y -= 18;

      if (sectionEvents.length === 0) {
        page.drawText('No scheduled events in this category.', {
          x: margin + 10,
          y,
          size: 10,
          font: helvetica,
          color: rgb(0.5, 0.5, 0.5),
        });
        y -= 20;
        return;
      }

      // Table Header
      checkPageBreak(25);
      page.drawRectangle({
        x: margin,
        y: y - 4,
        width: contentWidth,
        height: 18,
        color: rgb(0.94, 0.96, 0.98),
      });

      page.drawText('DATE', { x: margin + 8, y, size: 9, font: helveticaBold, color: rgb(0.3, 0.35, 0.4) });
      page.drawText('TYPE', { x: margin + 95, y, size: 9, font: helveticaBold, color: rgb(0.3, 0.35, 0.4) });
      page.drawText('EVENT TITLE', { x: margin + 185, y, size: 9, font: helveticaBold, color: rgb(0.3, 0.35, 0.4) });
      page.drawText('LOCATION / DETAILS', { x: margin + 370, y, size: 9, font: helveticaBold, color: rgb(0.3, 0.35, 0.4) });
      y -= 20;

      // Event rows
      for (const ev of sectionEvents) {
        checkPageBreak(22);

        // Date text
        const dateStr = ev.endDate && ev.endDate !== ev.startDate
          ? `${ev.startDate} to ${ev.endDate}`
          : ev.startDate;

        page.drawText(dateStr, {
          x: margin + 8,
          y,
          size: 8.5,
          font: helveticaBold,
          color: rgb(0.15, 0.2, 0.25),
        });

        // Type
        const typeStr = (ev.eventTypeName || ev.eventTypeSlug || 'Event').substring(0, 16);
        page.drawText(typeStr, {
          x: margin + 95,
          y,
          size: 8.5,
          font: helvetica,
          color: rgb(0.25, 0.3, 0.35),
        });

        // Title
        const titleStr = ev.title.length > 34 ? `${ev.title.substring(0, 32)}...` : ev.title;
        page.drawText(titleStr, {
          x: margin + 185,
          y,
          size: 8.5,
          font: helveticaBold,
          color: ev.sourceType === 'OFFICIAL' ? rgb(0.08, 0.35, 0.65) : rgb(0.1, 0.1, 0.1),
        });

        // Location / Time
        const detailParts: string[] = [];
        if (!ev.allDay && ev.startTime) {
          detailParts.push(`${ev.startTime}${ev.endTime ? `-${ev.endTime}` : ''}`);
        }
        if (ev.location) {
          detailParts.push(ev.location);
        }
        const detailStr = detailParts.join(' | ') || (ev.allDay ? 'All Day' : '-');
        const truncDetail = detailStr.length > 24 ? `${detailStr.substring(0, 22)}..` : detailStr;

        page.drawText(truncDetail, {
          x: margin + 370,
          y,
          size: 8.5,
          font: helvetica,
          color: rgb(0.4, 0.45, 0.5),
        });

        // Row underline
        y -= 5;
        page.drawLine({
          start: { x: margin, y },
          end: { x: pageWidth - margin, y },
          thickness: 0.5,
          color: rgb(0.9, 0.92, 0.94),
        });
        y -= 14;
      }

      y -= 15;
    };

    // Render Official Events
    renderEventSection('Official Academic Dates', officialEvents);

    // Render Personal / School Events
    if (personalEvents.length > 0 || calendar.calendarScope !== 'OFFICIAL') {
      renderEventSection('Personal & Custom Events', personalEvents);
    }

    // Add page numbers
    const totalPages = pdfDoc.getPageCount();
    for (let i = 0; i < totalPages; i++) {
      const p = pdfDoc.getPage(i);
      p.drawText(`Page ${i + 1} of ${totalPages} - Education Platform Calendar`, {
        x: margin,
        y: 25,
        size: 8,
        font: helvetica,
        color: rgb(0.55, 0.6, 0.65),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const sanitizedTitle = docTitle.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filename = `${sanitizedTitle}-${new Date().toISOString().split('T')[0]}.pdf`;

    return {
      buffer,
      contentType: 'application/pdf',
      filename,
      metadata: {
        calendarId: calendar.id,
        calendarScope: calendar.calendarScope,
        eventCount: String(events.length),
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
