// Test de validación de cookies - Ejecutar en consola del navegador

// Cookie de ejemplo del usuario
const testCookie = "ubid-main=130-1428977-2448637;session-token=PCoNCzN/2TozcfNHDpqiLjE8WzFx3dukrnH5kUfZQOL9AGcyMRTvpqWL+c+K97dW3VYumSIepcEfk3S1b8h1oAeyJqXbq4dzJZrJDfhpKbWDwE+XrlSDN6yyZ++Y2cwvknJwlrdpACJfI7hBxS3S4ykBvYulHJ3E3KBaM9t5pCu2sxDe/YKWcDhUXSRCImVfh4WzZV8/853Lo79YxrmXzO+/1MNiCIWR;i18n-prefs=USD;csm-hit=tb:9QDQD5NS0KH454KQE5Z8+s-PARVAK16KSDQ8WEENZQ1|1773102151025&t:1773102151025&adb:adblk_no;session-id-time=2082787201l;id_pk=eyJuIjoiMSJ9;id_pkel=n1;lc-main=es_US;rxc=AH39WanP5oBnwnzD7dU;session-id=138-8478272-4266640;skin=noskin";

// Función de parseo (copiar desde app.js)
function parseCookiePairs(cookieText) {
  const map = {};
  if (!cookieText || !cookieText.trim()) return map;

  const parts = cookieText.split(";");
  for (const part of parts) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      return null;
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      return null;
    }
    map[key] = value;
  }

  return map;
}

// Test
console.log("🧪 Testing cookie parsing...");
const parsed = parseCookiePairs(testCookie);

if (parsed) {
  console.log("✅ Cookie parseada correctamente");
  console.log("📊 Claves detectadas:", Object.keys(parsed));
  console.log("📋 Contenido completo:", parsed);
  
  // Validar campos específicos
  const validations = {
    "ubid-main": /^\d{3}-\d{7}-\d{7}$/.test(parsed["ubid-main"]),
    "session-id": /^\d{3}-\d{7}-\d{7}$/.test(parsed["session-id"]),
    "session-id-time": parsed["session-id-time"]?.endsWith("l"),
    "csm-hit": parsed["csm-hit"]?.startsWith("tb:"),
    "id_pk": parsed["id_pk"] === "eyJuIjoiMSJ9",
    "id_pkel": parsed["id_pkel"] === "n1",
    "skin": parsed["skin"] === "noskin"
  };
  
  console.log("✅ Validaciones:");
  Object.entries(validations).forEach(([key, isValid]) => {
    console.log(`  ${isValid ? "✅" : "❌"} ${key}: ${isValid ? "VÁLIDO" : "INVÁLIDO"}`);
  });
  
  const allValid = Object.values(validations).every(v => v);
  console.log(allValid ? "🎉 ¡COOKIE COMPLETAMENTE VÁLIDA!" : "⚠️ Algunos campos no pasaron validación");
} else {
  console.log("❌ Error al parsear la cookie");
}
