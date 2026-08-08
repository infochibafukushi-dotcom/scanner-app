const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const baseOutputName = (fileName: string) =>
  fileName.replace(/\.(pdf|txt|docx)$/i, '') || 'scan'

export const downloadTextFile = (texts: string[], fileName: string) => {
  const body = texts
    .map((text, index) => `--- ${index + 1}ページ ---\n${text || '（文字を認識できませんでした）'}`)
    .join('\n\n')
  const blob = new Blob(['\uFEFF', body], { type: 'text/plain;charset=utf-8' })
  downloadBlob(blob, `${baseOutputName(fileName)}.txt`)
}

export const downloadWordFile = async (texts: string[], fileName: string) => {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')

  const children = texts.flatMap((text, index) => {
    const lines = (text || '（文字を認識できませんでした）').split(/\r?\n/)
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(`${index + 1}ページ`)]
      }),
      ...lines.map((line) => new Paragraph({
        children: [new TextRun(line || ' ')]
      }))
    ]
  })

  const document = new Document({
    sections: [{
      properties: {},
      children
    }]
  })

  const blob = await Packer.toBlob(document)
  downloadBlob(blob, `${baseOutputName(fileName)}.docx`)
}
