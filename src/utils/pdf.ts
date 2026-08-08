import { jsPDF } from 'jspdf'
import type { ScanPage } from '../types'
import { renderScanPage } from './image'

export const buildPdfBlob = async (pages: ScanPage[]) => {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })

  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await renderScanPage(pages[index])
    const imageData = canvas.toDataURL('image/jpeg', 0.92)
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
    const width = canvas.width * ratio
    const height = canvas.height * ratio
    const x = (pageWidth - width) / 2
    const y = (pageHeight - height) / 2

    if (index > 0) pdf.addPage()
    pdf.addImage(imageData, 'JPEG', x, y, width, height)
  }

  return pdf.output('blob')
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
