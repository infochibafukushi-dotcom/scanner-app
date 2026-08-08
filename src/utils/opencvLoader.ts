let cvPromise: Promise<any> | undefined
let loadedCv: any

const hasRuntime = (candidate: any) => candidate && typeof candidate.Mat === 'function'

export const isOpenCvLoaded = () => Boolean(loadedCv && hasRuntime(loadedCv))

/** Loads OpenCV only for the high-resolution stitching workflow. */
export const loadOpenCv = (): Promise<any> => {
  if (isOpenCvLoaded()) return Promise.resolve(loadedCv)
  if (cvPromise) return cvPromise

  cvPromise = import('@techstark/opencv-js')
    .then(async (module) => {
      const cv = await Promise.resolve((module as any).default ?? module)
      if (hasRuntime(cv)) return cv

      return new Promise<any>((resolve, reject) => {
        if (!cv) {
          reject(new Error('OpenCV モジュールを読み込めませんでした。'))
          return
        }
        const timeout = window.setTimeout(
          () => reject(new Error('OpenCV の初期化がタイムアウトしました。')),
          15000
        )
        const finish = () => {
          window.clearTimeout(timeout)
          hasRuntime(cv)
            ? resolve(cv)
            : reject(new Error('OpenCV の機能を初期化できませんでした。'))
        }
        const previous = cv.onRuntimeInitialized
        cv.onRuntimeInitialized = () => {
          try {
            previous?.()
          } finally {
            finish()
          }
        }
        if (hasRuntime(cv)) finish()
      })
    })
    .then((cv) => {
      loadedCv = cv
      return cv
    })
    .catch((error) => {
      cvPromise = undefined
      throw error
    })

  return cvPromise
}
/** Warm up the optional OpenCV chunk without making capture depend on it. */
export const preloadOpenCv = async () => {
  await import('@techstark/opencv-js')
}
