# WhatsApp Gastos Bot

Bot de WhatsApp para registrar gastos e ingresos personales directamente en Google Sheets.

## Setup

### 1. Instalá dependencias

```bash
npm install
```

### 2. Configurá Google Sheets

1. Andá a [Google Cloud Console](https://console.cloud.google.com/)
2. Creá un proyecto nuevo (o usá uno existente)
3. Activá la API **Google Sheets API**
4. Creá una **Service Account**: IAM & Admin → Service Accounts → Create
5. Generá una clave JSON: en la service account, pestaña *Keys* → Add Key → JSON
6. Guardá ese archivo como `credentials.json` en la raíz del proyecto
7. Creá un Google Sheet y **compartilo** con el email de la service account (con permisos de editor)
8. Copiá el ID del Sheet desde la URL: `docs.google.com/spreadsheets/d/**ESTE_ID**/edit`

### 3. Configurá las variables de entorno

```bash
cp .env.example .env
```

Editá `.env`:

```env
AUTHORIZED_NUMBER=5491112345678@s.whatsapp.net
SHEET_ID=tu_sheet_id_aqui
CREDENTIALS_PATH=./credentials.json
```

> El formato del número es el código de país sin `+`, seguido del número, sin espacios, con `@s.whatsapp.net`.

### 4. Iniciá el bot

```bash
npm start
```

La primera vez va a mostrar un QR en la terminal. Escanealo desde WhatsApp en tu celular (*Dispositivos vinculados → Vincular un dispositivo*).

La sesión se guarda en `auth_info_baileys/` — no vas a necesitar escanear el QR de nuevo salvo que cierres sesión.

---

## Uso

Mandá mensajes al número vinculado desde el número autorizado:

| Mensaje | Resultado |
|---|---|
| `gasto 1500 super` | Registra gasto de $1500 en Super |
| `gasto 500 farmacia medicamentos` | Registra gasto con descripción |
| `ingreso 80000 sueldo diciembre` | Registra ingreso |
| `resumen` | Muestra totales del mes actual |

### Formato

```
<tipo> <monto> <categoría> [descripción opcional]
```

- **tipo**: `gasto` o `ingreso`
- **monto**: número (acepta coma o punto como decimal)
- **categoría**: una palabra
- **descripción**: todo lo que sigue (opcional)

---

## Estructura del Sheet

La hoja **Registros** se crea automáticamente con estas columnas:

| Fecha | Hora | Tipo | Monto | Categoría | Descripción |
|---|---|---|---|---|---|
| 05/01/2026 | 14:32 | Gasto | 1500 | Super | |
| 05/01/2026 | 18:00 | Ingreso | 80000 | Sueldo | diciembre |
