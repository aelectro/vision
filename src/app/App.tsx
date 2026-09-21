import { HashRouter, Navigate, Route, Routes } from 'react-router'

import { AppLayout } from '~/app/AppLayout'
import { CaptureRoute } from '~/app/routes/CaptureRoute'
import { GalleryRoute } from '~/app/routes/GalleryRoute'
import { SettingsRoute } from '~/app/routes/SettingsRoute'
import { VisionRoute } from '~/app/routes/VisionRoute'

/**
 * Hash routing is deliberate: the app is served as static files with no
 * server-side rewrites, and hash URLs keep deep links working inside an
 * iOS home-screen web app.
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<CaptureRoute />} />
          <Route path="gallery" element={<GalleryRoute />} />
          <Route path="vision/:id" element={<VisionRoute />} />
          <Route path="settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
