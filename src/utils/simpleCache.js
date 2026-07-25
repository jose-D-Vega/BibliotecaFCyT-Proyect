// Cache en memoria muy simple, con expiración por TTL. Pensado para datos
// que no dependen del usuario que los pide (estadísticas globales, etc.)
// y que no necesitan estar 100% al instante — tolera unos segundos de
// desactualización a cambio de no repetir las mismas queries pesadas en
// cada carga de página.
//
// No es un cache distribuido: vive en la memoria de esta instancia de
// Node. Si el backend corre en varias instancias, cada una tiene su
// propio cache (no rompe nada, solo significa que la primera carga en
// cada instancia paga el costo real).

const store = new Map()

const cacheGet = (key) => {
  const entry = store.get(key)
  if (!entry) return undefined

  if (Date.now() > entry.expiraEn) {
    store.delete(key)
    return undefined
  }

  return entry.valor
}

const cacheSet = (key, valor, ttlMs) => {
  store.set(key, {
    valor,
    expiraEn: Date.now() + ttlMs
  })
}

const cacheDelete = (key) => {
  store.delete(key)
}

module.exports = { cacheGet, cacheSet, cacheDelete }