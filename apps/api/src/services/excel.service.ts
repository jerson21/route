import * as XLSX from 'xlsx';

export interface AddressFromExcel {
  street: string;
  number?: string;
  unit?: string; // Depto, Casa, Oficina, Local, etc.
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
}

interface ParseResult {
  success: boolean;
  data: AddressFromExcel[];
  errors: string[];
  totalRows: number;
}

// Mapeo de nombres de columnas en español/inglés
const columnMappings: Record<string, keyof AddressFromExcel> = {
  // Español
  'calle': 'street',
  'direccion': 'street',
  'dirección': 'street',
  'numero': 'number',
  'número': 'number',
  'num': 'number',
  'no.': 'number',
  'depto': 'unit',
  'departamento': 'unit',
  'unidad': 'unit',
  'casa': 'unit',
  'oficina': 'unit',
  'local': 'unit',
  'piso': 'unit',
  'ciudad': 'city',
  'estado': 'state',
  'provincia': 'state',
  'cp': 'postalCode',
  'codigo postal': 'postalCode',
  'código postal': 'postalCode',
  'pais': 'country',
  'país': 'country',
  'cliente': 'customerName',
  'nombre': 'customerName',
  'nombre cliente': 'customerName',
  'telefono': 'customerPhone',
  'teléfono': 'customerPhone',
  'tel': 'customerPhone',
  'celular': 'customerPhone',
  'notas': 'notes',
  'observaciones': 'notes',
  'comentarios': 'notes',
  // Inglés
  'street': 'street',
  'address': 'street',
  'number': 'number',
  'unit': 'unit',
  'flat': 'unit',
  'apartment': 'unit',
  'apt': 'unit',
  'suite': 'unit',
  'floor': 'unit',
  'city': 'city',
  'state': 'state',
  'postal code': 'postalCode',
  'zip': 'postalCode',
  'zipcode': 'postalCode',
  'country': 'country',
  'customer': 'customerName',
  'customer name': 'customerName',
  'name': 'customerName',
  'phone': 'customerPhone',
  'telephone': 'customerPhone',
  'notes': 'notes',
  'comments': 'notes'
};

function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim().replace(/[_-]/g, ' ');
}

function mapColumns(headers: string[]): Map<number, keyof AddressFromExcel> {
  const mapping = new Map<number, keyof AddressFromExcel>();

  headers.forEach((header, index) => {
    const normalized = normalizeColumnName(header);
    const mappedField = columnMappings[normalized];
    if (mappedField) {
      mapping.set(index, mappedField);
    }
  });

  return mapping;
}

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const errors: string[] = [];
  const addresses: AddressFromExcel[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return {
        success: false,
        data: [],
        errors: ['El archivo Excel está vacío'],
        totalRows: 0
      };
    }

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { header: 1 });

    if (jsonData.length < 2) {
      return {
        success: false,
        data: [],
        errors: ['El archivo debe tener al menos una fila de encabezados y una de datos'],
        totalRows: 0
      };
    }

    const headers = (jsonData[0] as string[]).map(h => String(h || ''));
    const columnMap = mapColumns(headers);

    // Verificar columnas requeridas
    const hasStreet = Array.from(columnMap.values()).includes('street');
    const hasCity = Array.from(columnMap.values()).includes('city');

    if (!hasStreet || !hasCity) {
      return {
        success: false,
        data: [],
        errors: ['Faltan columnas requeridas: calle/dirección y ciudad'],
        totalRows: jsonData.length - 1
      };
    }

    // Procesar filas de datos
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i] as any[];
      if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) {
        continue; // Saltar filas vacías
      }

      const address: Partial<AddressFromExcel> = {};

      columnMap.forEach((field, colIndex) => {
        const value = row[colIndex];
        if (value !== null && value !== undefined && value !== '') {
          address[field] = String(value).trim();
        }
      });

      // Validar campos requeridos
      if (!address.street || !address.city) {
        errors.push(`Fila ${i + 1}: Faltan campos requeridos (calle y ciudad)`);
        continue;
      }

      addresses.push({
        street: address.street,
        number: address.number,
        unit: address.unit,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country || 'Chile',
        customerName: address.customerName,
        customerPhone: address.customerPhone,
        notes: address.notes
      });
    }

    return {
      success: addresses.length > 0,
      data: addresses,
      errors,
      totalRows: jsonData.length - 1
    };
  } catch (error) {
    return {
      success: false,
      data: [],
      errors: [error instanceof Error ? error.message : 'Error al procesar el archivo Excel'],
      totalRows: 0
    };
  }
}
