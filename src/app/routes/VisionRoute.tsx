import { useParams } from 'react-router'

export function VisionRoute() {
  const { id } = useParams()

  return (
    <section style={{ padding: 24 }}>
      <h1>Vision</h1>
      <p style={{ color: 'var(--text-dim)' }}>Original, transformation and video for {id}.</p>
    </section>
  )
}
