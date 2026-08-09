import { jsPDF } from 'jspdf'
import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from './image'
import { migratePaperSize, resolvePdfFormat } from './paper'

export const buildPdfBlob = async (pages: ScanPage[]) => {
  if (!pages.length) throw new Error('ページがありません。')

  let pdf: jsPDF | null = null

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    const canvas = await renderScanPage(page, RENDER_MAX.export)
    const imageData = canvas.toDataURL('image/jpeg', 0.95)
    const { format, orientation } = resolvePdfFormat(migratePaperSize(page), canvas.width, canvas.height)

    if (!pdf) {
      pdf = new jsPDF({ unit: 'pt', format, orientation, compress: true })
    } else {
      pdf.addPage(format, orientation)
    }

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
    const width = canvas.width * ratio
    const height = canvas.height * ratio
    const x = (pageWidth - width) / 2
    const y = (pageHeight - height) / 2
    pdf.addImage(imageData, 'JPEG', x, y, width, height)
  }

  return pdf!.output('blob')
}

export const downloadPdf = async (pages: ScanPage[], fileName: string) => {
  const blob = await buildPdfBlob(pages)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
