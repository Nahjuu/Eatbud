import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';

const {
  app,
  localDateInTZ,
  getYesterdayInTZ,
  msUntilNextMidnightUY,
  dateRangeForLocalDay,
  weekRangeForLocalDates,
  getMonday,
  getDailySummary,
  closeDailySummary,
  supabase,
} = await import('../server.js');

let server;
let baseUrl;

const userA = `test-user-alice-${Date.now()}`;
const userB = `test-user-bob-${Date.now()}`;

describe('EATBUD - Pruebas Obligatorias de Cierre Diario, Resúmenes y Dashboard Semanal', () => {
  before(async () => {
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    // Limpieza de datos de prueba
    await supabase.from('daily_logs').delete().in('user_id', [userA, userB]);
    await supabase.from('daily_summaries').delete().in('user_id', [userA, userB]);
    await new Promise((resolve) => server.close(resolve));
  });

  // 1. Un usuario registra una comida y aparece en el dashboard diario.
  test('1. Un usuario registra una comida y aparece en el dashboard diario', async () => {
    const res = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: '200g de pollo a la plancha y 100g de arroz',
        parsed_data: {
          foods: [
            { name: 'Pollo a la plancha', quantity: 200, unit: 'g', calories: 330, protein: 62, carbs: 0, fat: 7 },
            { name: 'Arroz blanco', quantity: 100, unit: 'g', calories: 130, protein: 3, carbs: 28, fat: 0.5 },
          ],
          totals: { calories: 460, protein: 65, carbs: 28, fat: 7.5 },
        },
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.entry);
    assert.equal(data.entry.foodText, '200g de pollo a la plancha y 100g de arroz');
    assert.equal(data.summary.totals.calories, 460);
    assert.equal(data.summary.entries.length, 1);
    assert.equal(data.summary.entries[0].id, data.entry.id);
  });

  // 2. La comida y sus datos nutricionales persisten después de recargar la página.
  test('2. La comida y sus datos nutricionales persisten tras recargar (GET /api/daily-summary)', async () => {
    const res = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });

    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.entries.length, 1);
    assert.equal(summary.totals.calories, 460);
    assert.equal(summary.totals.protein, 65);
    assert.equal(summary.totals.carbs, 28);
    assert.equal(summary.totals.fat, 7.5);
    assert.equal(summary.entries[0].foods.length, 2);
  });

  // 3. El resumen diario contiene los valores correctos de las comidas registradas.
  test('3. El resumen diario suma correctamente múltiples comidas del día', async () => {
    // Registrar una segunda comida
    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: '1 manzana y un puñado de nueces',
        parsed_data: {
          foods: [
            { name: 'Manzana', quantity: 1, unit: 'unidad', calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
            { name: 'Nueces', quantity: 30, unit: 'g', calories: 196, protein: 4.3, carbs: 4.1, fat: 19.6 },
          ],
          totals: { calories: 291, protein: 4.8, carbs: 29.1, fat: 19.9 },
        },
      }),
    });

    const res = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const summary = await res.json();
    assert.equal(summary.entries.length, 2);
    // 460 + 291 = 751 kcal
    assert.equal(summary.totals.calories, 751);
    assert.equal(summary.totals.protein, 69.8);
    assert.equal(summary.totals.carbs, 57.1);
    assert.equal(summary.totals.fat, 27.4);
  });

  // 4. Al cambiar de día, la vista diaria queda vacía sin borrar los registros anteriores.
  test('4. Al cambiar de día, la vista del nuevo día está limpia con totales en cero y conserva registros anteriores', async () => {
    // Simulamos un día futuro donde no hay comidas
    const futureDate = '2026-11-20';
    const res = await fetch(`${baseUrl}/api/daily-summary?date=${futureDate}`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });

    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.date, futureDate);
    assert.equal(summary.entries.length, 0);
    assert.deepEqual(summary.totals, { calories: 0, protein: 0, carbs: 0, fat: 0 });

    // Verificamos que el día de hoy sigue conservando sus comidas
    const todayRes = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const todaySummary = await todayRes.json();
    assert.equal(todaySummary.entries.length, 2);
    assert.equal(todaySummary.totals.calories, 751);
  });

  // 5. El día anterior aparece en Resúmenes.
  test('5. Las comidas de días anteriores aparecen en Resúmenes (GET /api/history/days)', async () => {
    // Insertamos una comida en una fecha anterior: 2026-10-10
    const pastLoggedAt = '2026-10-10T16:00:00.000Z';
    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Pasta con salsa boloñesa',
        loggedAt: pastLoggedAt,
        parsed_data: {
          foods: [{ name: 'Pasta boloñesa', quantity: 350, unit: 'g', calories: 550, protein: 25, carbs: 70, fat: 18 }],
          totals: { calories: 550, protein: 25, carbs: 70, fat: 18 },
        },
      }),
    });

    const res = await fetch(`${baseUrl}/api/history/days`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });

    assert.equal(res.status, 200);
    const { days, today } = await res.json();
    assert.ok(Array.isArray(days));
    // El día de hoy NO debe aparecer en el historial pasado
    assert.ok(!days.some((d) => d.date === today));
    // El día 2026-10-10 DEBE aparecer en el historial
    const pastDay = days.find((d) => d.date === '2026-10-10');
    assert.ok(pastDay, 'El día 2026-10-10 debe estar en Resúmenes');
    assert.equal(pastDay.mealCount, 1);
    assert.equal(pastDay.totals.calories, 550);
  });

  // 6. La vista semanal muestra todas las comidas individuales agrupadas por la fecha correcta.
  test('6. La vista semanal muestra comidas individuales agrupadas por su fecha correspondiente', async () => {
    // Semana del 2026-10-12 (lunes) al 2026-10-18 (domingo)
    // Agregamos una comida el miércoles 2026-10-14 y otra el viernes 2026-10-16
    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Almuerzo Miércoles: Ensalada César',
        loggedAt: '2026-10-14T15:30:00.000Z',
        parsed_data: {
          foods: [{ name: 'Ensalada César', quantity: 1, unit: 'porción', calories: 400, protein: 20, carbs: 15, fat: 28 }],
          totals: { calories: 400, protein: 20, carbs: 15, fat: 28 },
        },
      }),
    });

    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Cena Viernes: Pizza margarita',
        loggedAt: '2026-10-16T00:30:00.000Z', // 21:30 del jueves 15 o madrugada según hora
        parsed_data: {
          foods: [{ name: 'Pizza margarita', quantity: 2, unit: 'porciones', calories: 520, protein: 18, carbs: 64, fat: 20 }],
          totals: { calories: 520, protein: 18, carbs: 64, fat: 20 },
        },
      }),
    });

    const res = await fetch(`${baseUrl}/api/weekly-summary?weekStart=2026-10-12`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });

    assert.equal(res.status, 200);
    const weekly = await res.json();
    assert.equal(weekly.weekStart, '2026-10-12');
    assert.equal(weekly.weekEnd, '2026-10-18');
    assert.equal(weekly.days.length, 7);

    // Verificar que el miércoles 2026-10-14 tiene la ensalada
    const wednesday = weekly.days.find((d) => d.date === '2026-10-14');
    assert.ok(wednesday);
    assert.ok(wednesday.entries.some((e) => e.foodText.includes('Ensalada César')));
  });

  // 7. Los totales diarios y semanales coinciden con las comidas almacenadas.
  test('7. Los totales semanales coinciden exactamente con la suma de días y comidas', async () => {
    const res = await fetch(`${baseUrl}/api/weekly-summary?weekStart=2026-10-12`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const weekly = await res.json();

    let computedCalories = 0;
    let computedProtein = 0;
    let computedCarbs = 0;
    let computedFat = 0;
    let computedMeals = 0;

    for (const day of weekly.days) {
      computedCalories += day.totals.calories;
      computedProtein += day.totals.protein;
      computedCarbs += day.totals.carbs;
      computedFat += day.totals.fat;
      computedMeals += day.entries.length;
    }

    assert.equal(weekly.totals.calories, Math.round(computedCalories * 10) / 10);
    assert.equal(weekly.totals.protein, Math.round(computedProtein * 10) / 10);
    assert.equal(weekly.totalMeals, computedMeals);
  });

  // 8. Volver a ejecutar el cierre del mismo día no produce duplicados.
  test('8. Volver a ejecutar el cierre del mismo día es idempotente y no genera duplicados', async () => {
    const testDate = '2026-10-10';

    // Ejecución 1
    const res1 = await fetch(`${baseUrl}/api/daily-summary/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({ date: testDate }),
    });
    assert.equal(res1.status, 200);

    // Ejecución 2 (inmediatamente después)
    const res2 = await fetch(`${baseUrl}/api/daily-summary/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({ date: testDate }),
    });
    assert.equal(res2.status, 200);

    // Ejecución 3 vía función de backend
    await closeDailySummary(userA, testDate);

    // Comprobamos en la base de datos que existe exactamente 1 registro para userA y testDate
    const { data: rows, error } = await supabase
      .from('daily_summaries')
      .select('id, date, user_id')
      .eq('user_id', userA)
      .eq('date', testDate);

    assert.ifError(error);
    assert.equal(rows.length, 1, 'Debe haber exactamente un registro en daily_summaries para ese día');
  });

  // 9. Los cambios de fecha se calculan correctamente con America/Montevideo.
  test('9. El cálculo de fechas respeta la zona horaria America/Montevideo (UTC-3)', () => {
    // 2026-10-15T02:59:59.000Z es todavía las 23:59:59 del 2026-10-14 en Montevideo
    const instant1 = new Date('2026-10-15T02:59:59.000Z');
    assert.equal(localDateInTZ(instant1), '2026-10-14');

    // 2026-10-15T03:00:00.000Z es exactamente las 00:00:00 del 2026-10-15 en Montevideo
    const instant2 = new Date('2026-10-15T03:00:00.000Z');
    assert.equal(localDateInTZ(instant2), '2026-10-15');

    // Rango del día 2026-10-15
    const range = dateRangeForLocalDay('2026-10-15');
    assert.equal(range.start, '2026-10-15T03:00:00.000Z');
    assert.equal(range.end, '2026-10-16T03:00:00.000Z');
  });

  // 10. Una comida cercana a la medianoche se asigna al día correcto.
  test('10. Comida registrada a las 23:55 hora local de Uruguay se asigna a esa fecha y no al día siguiente UTC', async () => {
    // 23:55 del 2026-10-15 en Montevideo = 2026-10-16T02:55:00.000Z UTC
    const nearMidnight = '2026-10-16T02:55:00.000Z';
    const postRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Snack de medianoche: Yogur griego',
        loggedAt: nearMidnight,
        parsed_data: {
          foods: [{ name: 'Yogur griego', quantity: 150, unit: 'g', calories: 140, protein: 15, carbs: 6, fat: 5 }],
          totals: { calories: 140, protein: 15, carbs: 6, fat: 5 },
        },
      }),
    });
    assert.equal(postRes.status, 201);

    // Consulta del día 2026-10-15
    const res15 = await fetch(`${baseUrl}/api/daily-summary?date=2026-10-15`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const summary15 = await res15.json();
    assert.ok(summary15.entries.some((e) => e.foodText.includes('Snack de medianoche')));

    // Consulta del día 2026-10-16 (NO debe estar este snack)
    const res16 = await fetch(`${baseUrl}/api/daily-summary?date=2026-10-16`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const summary16 = await res16.json();
    assert.ok(!summary16.entries.some((e) => e.foodText.includes('Snack de medianoche')));
  });

  // 11. Las semanas anteriores pueden consultarse sin alterar los datos actuales.
  test('11. Consultar semanas anteriores no altera los datos actuales ni el dashboard', async () => {
    const todaySummaryBefore = await (await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    })).json();

    // Consultamos una semana de hace un mes
    const pastWeekRes = await fetch(`${baseUrl}/api/weekly-summary?weekStart=2026-09-07`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    assert.equal(pastWeekRes.status, 200);

    // El dashboard de hoy permanece idéntico
    const todaySummaryAfter = await (await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    })).json();

    assert.equal(todaySummaryAfter.entries.length, todaySummaryBefore.entries.length);
    assert.equal(todaySummaryAfter.totals.calories, todaySummaryBefore.totals.calories);
  });

  // 12. Un usuario no puede consultar los registros de otro.
  test('12. Estricta separación de usuarios: Usuario B no ve ni puede alterar registros de Usuario A', async () => {
    // Usuario B consulta resumen diario
    const bDailyRes = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userB}` },
    });
    const bDaily = await bDailyRes.json();
    assert.equal(bDaily.entries.length, 0);
    assert.equal(bDaily.totals.calories, 0);

    // Usuario B consulta historial
    const bHistRes = await fetch(`${baseUrl}/api/history/days`, {
      headers: { 'Authorization': `Bearer ${userB}` },
    });
    const bHist = await bHistRes.json();
    assert.equal(bHist.days.length, 0);

    // Usuario A tiene comidas. Obtenemos un id de comida de Usuario A
    const aDailyRes = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const aDaily = await aDailyRes.json();
    const entryAId = aDaily.entries[0].id;

    // Usuario B intenta eliminar la comida de Usuario A -> debe dar 404
    const bDeleteRes = await fetch(`${baseUrl}/api/logs/${entryAId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${userB}` },
    });
    assert.equal(bDeleteRes.status, 404);

    // Usuario B intenta actualizar la comida de Usuario A -> debe dar 404
    const bPutRes = await fetch(`${baseUrl}/api/logs/${entryAId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userB}`,
      },
      body: JSON.stringify({ foodText: 'Comida hackeada' }),
    });
    assert.equal(bPutRes.status, 404);

    // Petición sin token -> 401 Unauthorized
    const unauthRes = await fetch(`${baseUrl}/api/daily-summary`);
    assert.equal(unauthRes.status, 401);
  });

  // 13. Los días sin comidas se muestran sin errores ni valores ficticios.
  test('13. Los días sin comidas se procesan limpiamente con 0 calorías y sin registros ficticios', async () => {
    const emptyDate = '2026-05-12';
    const res = await fetch(`${baseUrl}/api/daily-summary?date=${emptyDate}`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entries.length, 0);
    assert.equal(data.totals.calories, 0);
    assert.equal(data.totals.protein, 0);
    assert.equal(data.totals.carbs, 0);
    assert.equal(data.totals.fat, 0);

    // Cierre diario de un día vacío no crea registros ficticios
    await closeDailySummary(userA, emptyDate);
    const { data: rows } = await supabase
      .from('daily_summaries')
      .select('id')
      .eq('user_id', userA)
      .eq('date', emptyDate);

    assert.equal(rows.length, 0, 'No debe persistir resúmenes ficticios para días sin comidas');
  });

  // 14. Editar o eliminar una comida actualiza correctamente las vistas y los resúmenes afectados.
  test('14. Editar y eliminar una comida actualiza correctamente las vistas y totales en tiempo real', async () => {
    // 1. Crear una comida temporal
    const createRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Sandwich de jamón y queso',
        parsed_data: {
          foods: [{ name: 'Sandwich', quantity: 1, unit: 'unidad', calories: 300, protein: 15, carbs: 30, fat: 12 }],
          totals: { calories: 300, protein: 15, carbs: 30, fat: 12 },
        },
      }),
    });
    const created = await createRes.json();
    const targetId = created.entry.id;

    // 2. Editar la comida (cambiar porción y calorías)
    const editRes = await fetch(`${baseUrl}/api/logs/${targetId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA}`,
      },
      body: JSON.stringify({
        foodText: 'Doble sandwich de jamón y queso tostado',
        parsed_data: {
          foods: [{ name: 'Doble sandwich', quantity: 2, unit: 'unidades', calories: 600, protein: 30, carbs: 60, fat: 24 }],
          totals: { calories: 600, protein: 30, carbs: 60, fat: 24 },
        },
      }),
    });
    assert.equal(editRes.status, 200);
    const editData = await editRes.json();
    assert.equal(editData.entry.foodText, 'Doble sandwich de jamón y queso tostado');
    assert.equal(editData.entry.totals.calories, 600);

    // 3. Eliminar la comida
    const deleteRes = await fetch(`${baseUrl}/api/logs/${targetId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    assert.equal(deleteRes.status, 200);

    // Verificar que ya no existe
    const verifyRes = await fetch(`${baseUrl}/api/daily-summary`, {
      headers: { 'Authorization': `Bearer ${userA}` },
    });
    const verifyData = await verifyRes.json();
    assert.ok(!verifyData.entries.some((e) => e.id === targetId));
  });

  // 15. Funciones auxiliares y formateadores para móvil y escritorio.
  test('15. Verificación de cálculo de límites semanales (getMonday y weekRange)', () => {
    // Lunes 2026-10-12
    assert.equal(getMonday('2026-10-12'), '2026-10-12');
    // Miércoles 2026-10-14 -> Lunes 2026-10-12
    assert.equal(getMonday('2026-10-14'), '2026-10-12');
    // Domingo 2026-10-18 -> Lunes 2026-10-12
    assert.equal(getMonday('2026-10-18'), '2026-10-12');

    const weekRange = weekRangeForLocalDates('2026-10-12', '2026-10-18');
    assert.equal(weekRange.start, '2026-10-12T03:00:00.000Z');
    assert.equal(weekRange.end, '2026-10-19T03:00:00.000Z');
  });

  // 16. Verificación matemática de que el cierre ocurre estrictamente a las 00:00:00 de Uruguay.
  test('16. El cierre diario se ejecuta estrictamente a las 00:00:00 de horario uruguayo (no a las 21:00 / 00:00 UTC)', () => {
    // A las 21:00 en Uruguay (00:00 UTC del día siguiente): debe seguir siendo 2026-10-15 en Uruguay
    const at21UY = new Date('2026-10-16T00:00:00Z');
    assert.equal(localDateInTZ(at21UY), '2026-10-15');

    // A las 22:30 en Uruguay (01:30 UTC): debe seguir siendo 2026-10-15
    const at2230UY = new Date('2026-10-16T01:30:00Z');
    assert.equal(localDateInTZ(at2230UY), '2026-10-15');

    // A las 23:59:59 en Uruguay (02:59:59 UTC): sigue siendo 2026-10-15
    const at2359UY = new Date('2026-10-16T02:59:59Z');
    assert.equal(localDateInTZ(at2359UY), '2026-10-15');

    // A las 00:00:00 en Uruguay (03:00:00 UTC): aquí y exactamente aquí se produce el cambio a 2026-10-16
    const atMidnightUY = new Date('2026-10-16T03:00:00Z');
    assert.equal(localDateInTZ(atMidnightUY), '2026-10-16');

    // En ese instante exacto, la fecha anterior que se cierra es 2026-10-15
    assert.equal(getYesterdayInTZ(atMidnightUY), '2026-10-15');

    // Cálculo del tiempo restante: a las 21:00 en Uruguay, faltan exactamente 3 horas (10.800.000 ms) hasta las 00:00 UY
    const msUntilMidnight = msUntilNextMidnightUY(at21UY);
    assert.equal(msUntilMidnight, 3 * 60 * 60 * 1000);
  });
});
