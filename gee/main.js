// ============================================================================
// Расчёт C-фактора RUSLE для Белгородской области, 2008–2022
// ----------------------------------------------------------------------------
// Метод:    C = exp(-a * NDVI / (b - NDVI)), a = 2, b = 1
// Источник: Van der Knijff et al. (2000), применён к MODIS NDVI
// Вход:     MODIS/061/MOD13Q1 NDVI (16-дневный, 250 м)
// Сезон:    май–сентябрь (вегетационный период)
// Выход:    Годовые карты C-фактора + CSV со статистикой + экспорт в Drive
// Автор:    Бабушкин Кирилл Сергеевич
// Лицензия: MIT
// ============================================================================


// ----------------------------------------------------------------------------
// 1. КОНФИГУРАЦИЯ
// ----------------------------------------------------------------------------
var CONFIG = {
  aoiName:      'Belgorodskaya Oblast',
  startYear:    2008,
  endYear:      2022,
  scale:        250,
  a:            2,          // коэффициент RUSLE
  b:            1,          // коэффициент RUSLE
  seasonStart:  5,          // май
  seasonLength: 5,          // 5 месяцев → май–сентябрь
  ndviMaxClamp: 0.99,       // защита от деления на ~0 при NDVI → 1
  crs:          'EPSG:32637',  // UTM зона 37N
  exportFolder: 'GEE_rusle_c_factor'
};


// ----------------------------------------------------------------------------
// 2. ГРАНИЦЫ ИССЛЕДУЕМОЙ ТЕРРИТОРИИ
// ----------------------------------------------------------------------------
var aoiFC = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level1')
  .filter(ee.Filter.eq('ADM1_NAME', CONFIG.aoiName));

print('AOI features found:', aoiFC.size());   // должно быть 1

var AOI = aoiFC.geometry();
Map.centerObject(AOI, 8);

var YEARS = ee.List.sequence(CONFIG.startYear, CONFIG.endYear);


// ----------------------------------------------------------------------------
// 3. СРЕДНИЙ NDVI ЗА СЕЗОН (май–сентябрь, с маской QA)
// ----------------------------------------------------------------------------
// Значения SummaryQA:
//   -1 = заполнение, 0 = хорошо, 1 = приемлемо, 2 = снег/лёд, 3 = облака
function maskQA(img) {
  var qa = img.select('SummaryQA');
  return img.updateMask(qa.gte(0)).updateMask(qa.lte(1));
}

function annualNdvi(year) {
  year = ee.Number(year);
  var start = ee.Date.fromYMD(year, CONFIG.seasonStart, 1);
  var end   = start.advance(CONFIG.seasonLength, 'month');

  return ee.ImageCollection('MODIS/061/MOD13Q1')
    .select(['NDVI', 'SummaryQA'])
    .filterDate(start, end)
    .map(maskQA)
    .select('NDVI')                // убираем канал QA после маски
    .mean()
    .multiply(0.0001)              // масштабный коэффициент MODIS
    .clip(AOI)
    .rename('NDVI')
    .set('year', year)
    .set('system:time_start', start.millis());
}

var ndviSeries = ee.ImageCollection(YEARS.map(annualNdvi));


// ----------------------------------------------------------------------------
// 4. C-ФАКТОР RUSLE
// ----------------------------------------------------------------------------
function toCfactor(img) {
  // Ограничиваем NDVI физическим диапазоном: отрицательные значения
  // приходят от воды и остаточного снега
  var ndvi  = img.select('NDVI').clamp(0, CONFIG.ndviMaxClamp);
  var denom = ee.Image(CONFIG.b).subtract(ndvi);

  var c = ndvi.divide(denom)
    .multiply(-CONFIG.a)
    .exp()
    .min(1)   // C = 1 соответствует чистой почве (пар)
    .max(0)   // нижняя граница
    .rename('C');

  return c.copyProperties(img, ['year', 'system:time_start']);
}

var cSeries = ndviSeries.map(toCfactor);


// ----------------------------------------------------------------------------
// 5. ВИЗУАЛИЗАЦИЯ
// ----------------------------------------------------------------------------
var cVis = {
  min: 0,
  max: 1,
  palette: ['1a9850', 'ffffbf', 'd73027']
};

Map.addLayer(cSeries.first(), cVis, 'C-фактор ' + CONFIG.startYear);
Map.addLayer(
  cSeries.filter(ee.Filter.eq('year', CONFIG.endYear)).first(),
  cVis,
  'C-фактор ' + CONFIG.endYear,
  false
);


// ----------------------------------------------------------------------------
// 6. СТАТИСТИКА СРЕДНЕГО C-ФАКТОРА ПО ОБЛАСТИ
// ----------------------------------------------------------------------------
var cStats = ee.FeatureCollection(
  cSeries.map(function(img) {
    img = ee.Image(img).rename('C');

    var stats = img.reduceRegion({
      reducer:    ee.Reducer.mean(),
      geometry:   AOI,
      scale:      CONFIG.scale,
      maxPixels:  1e13,
      tileScale:  4
    });

    return ee.Feature(null, {
      year:   img.get('year'),
      C_mean: stats.get('C')
    });
  })
).sort('year');

print('Средний C-фактор по годам:', cStats);


// ----------------------------------------------------------------------------
// 7. ГРАФИК — ВРЕМЕННОЙ РЯД СРЕДНЕГО C-ФАКТОРА
// ----------------------------------------------------------------------------
var chartMean = ui.Chart.feature.byFeature({
  features:    cStats,
  xProperty:   'year',
  yProperties: ['C_mean']
})
.setChartType('LineChart')
.setOptions({
  title: 'Средний C-фактор RUSLE — ' + CONFIG.aoiName +
         ' (' + CONFIG.startYear + '–' + CONFIG.endYear + ')',
  hAxis:     {title: 'Год', format: '####'},
  vAxis:     {title: 'Средний C-фактор'},
  lineWidth: 2,
  pointSize: 5,
  legend:    {position: 'none'}
});

print(chartMean);


// ----------------------------------------------------------------------------
// 8. ТАБЛИЦА — СРЕДНИЕ ЗНАЧЕНИЯ ПО ГОДАМ
// ----------------------------------------------------------------------------
var statsTable = ui.Chart.feature.byFeature({
  features:    cStats,
  xProperty:   'year',
  yProperties: ['C_mean']
})
.setChartType('Table')
.setOptions({
  title:    'Средний C-фактор по годам — ' + CONFIG.aoiName,
  page:     'enable',
  pageSize: 20
});

print(statsTable);


// ----------------------------------------------------------------------------
// 9. ЭКСПОРТ — РАСТРЫ (15 годовых карт C-фактора)
// ----------------------------------------------------------------------------
YEARS.evaluate(function(years) {
  years.forEach(function(year) {
    var img = cSeries.filter(ee.Filter.eq('year', year)).first();

    Export.image.toDrive({
      image:       img.toFloat(),
      description: 'C_factor_' + CONFIG.aoiName.replace(/\s+/g, '_') + '_' + year,
      folder:      CONFIG.exportFolder,
      region:      AOI,
      scale:       CONFIG.scale,
      maxPixels:   1e13,
      crs:         CONFIG.crs
    });
  });
});


// ----------------------------------------------------------------------------
// 10. ЭКСПОРТ — CSV СО СРЕДНИМ C-ФАКТОРОМ
// ----------------------------------------------------------------------------
Export.table.toDrive({
  collection:  cStats,
  description: 'C_factor_mean_' + CONFIG.aoiName.replace(/\s+/g, '_'),
  folder:      CONFIG.exportFolder,
  fileFormat:  'CSV'
});