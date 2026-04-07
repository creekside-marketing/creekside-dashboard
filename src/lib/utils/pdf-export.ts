import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportPdf(): Promise<void> {
  const dashboard = document.getElementById('dashboard-panel');
  if (!dashboard) {
    throw new Error('Dashboard panel not found');
  }

  const canvas = await html2canvas(dashboard, {
    backgroundColor: '#0B0F1A',
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  // Use landscape or portrait based on aspect ratio
  const isLandscape = imgWidth > imgHeight;
  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [imgWidth + 80, imgHeight + 160],
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Header
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.setFillColor(11, 15, 26);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');

  pdf.setTextColor(99, 179, 237); // accent color
  pdf.setFontSize(18);
  pdf.text('ROAS Projection Report', 40, 40);
  pdf.setTextColor(156, 163, 175); // secondary text
  pdf.setFontSize(11);
  pdf.text('Powered by Creekside Marketing', 40, 58);

  // Dashboard image
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const scaledHeight = (imgHeight / imgWidth) * contentWidth;
  pdf.addImage(imgData, 'PNG', margin, 80, contentWidth, scaledHeight);

  // Footer
  const footerY = pageHeight - 30;
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  pdf.text(dateStr, 40, footerY);
  pdf.text('creeksidemarketingpros.com', pageWidth - 180, footerY);

  pdf.save('roas-projection-report.pdf');
}
