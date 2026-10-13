# ============================================================================
# utils.py — общие утилиты проекта RUSLE C-factor
# ----------------------------------------------------------------------------
# Используется в: 01_preprocessing.ipynb, 02_analysis.ipynb
# Author:  Babushkin Kirill Sergeevich
# License: MIT
# ============================================================================

import os
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


# ----------------------------------------------------------------------------
# Пути проекта
# ----------------------------------------------------------------------------
# utils.py лежит в .../python/, корень проекта — на уровень выше
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FIGURES_DIR  = PROJECT_ROOT / 'figures'
DATA_DIR     = PROJECT_ROOT / 'data'
OUTPUT_DIR   = PROJECT_ROOT / 'output'

# Создать папки, если их нет
for d in (FIGURES_DIR, DATA_DIR, OUTPUT_DIR):
    d.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------
# Сохранение фигур
# ----------------------------------------------------------------------------
def save_fig(fig, filename, dpi=300, folder=FIGURES_DIR, tight=True, close=False):
    """
    Сохраняет matplotlib-фигуру в папку figures.

    Parameters
    ----------
    fig : matplotlib.figure.Figure
        Объект фигуры (например, возвращённый plt.subplots()).
    filename : str
        Имя файла с расширением, например 'C_factor_timeseries.png'.
    dpi : int, default 300
        Разрешение (dots per inch).
    folder : Path or str, default FIGURES_DIR
        Куда сохранять. По умолчанию — папка figures в корне проекта.
    tight : bool, default True
        Использовать bbox_inches='tight' — обрезает лишние поля.
    close : bool, default False
        Закрыть фигуру после сохранения (освобождает память).

    Returns
    -------
    Path
        Полный путь к сохранённому файлу.

    Examples
    --------
    >>> fig, ax = plt.subplots()
    >>> ax.plot([1, 2, 3], [4, 5, 6])
    >>> save_fig(fig, 'example.png')
    PosixPath('/.../figures/example.png')
    """
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)

    path = folder / filename
    fig.savefig(path, dpi=dpi, bbox_inches='tight' if tight else None)

    print(f'Figure saved: {path.resolve()}')

    if close:
        plt.close(fig)

    return path


# ----------------------------------------------------------------------------
# Парсинг статистики GEE в DataFrame
# ----------------------------------------------------------------------------
def ee_stats_to_df(cStats, columns=('year', 'C_mean')):
    """
    Преобразует ee.FeatureCollection со статистикой в pandas.DataFrame.

    Parameters
    ----------
    cStats : ee.FeatureCollection
        Коллекция фич с полями year, C_mean (и др.).
    columns : tuple of str
        Какие колонки брать и в каком порядке.

    Returns
    -------
    pd.DataFrame
        Отсортированный по 'year' DataFrame с числовыми колонками.
    """
    stats_info = cStats.getInfo()

    records = [f['properties'] for f in stats_info['features']]
    df = pd.DataFrame(records)[list(columns)].sort_values('year').reset_index(drop=True)

    if 'year' in df.columns:
        df['year'] = df['year'].astype(int)

    for col in df.columns:
        if col != 'year':
            df[col] = pd.to_numeric(df[col], errors='coerce')

    return df


# ----------------------------------------------------------------------------
# Описательная статистика
# ----------------------------------------------------------------------------
def describe_df(df, column='C_mean'):
    """Краткая описательная статистика по колонке."""
    return df[column].describe()