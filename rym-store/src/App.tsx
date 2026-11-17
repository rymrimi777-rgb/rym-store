import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home, Catalog, ProductPage, Updates, About } from './pages'
export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/apps" element={<Catalog category="app" />} />
        <Route path="/games" element={<Catalog category="game" />} />
        <Route path="/p/:slug" element={<ProductPage />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
