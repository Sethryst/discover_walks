"""Repository-wide test environment normalization."""

import os
from pathlib import Path


def pytest_configure():
    """Prefer the virtualenv PROJ database over an incompatible system one."""
    repo = Path(__file__).parent
    bundled = repo / '.venv' / 'Lib' / 'site-packages' / 'rasterio' / 'proj_data'
    if (bundled / 'proj.db').exists():
        os.environ['PROJ_LIB'] = str(bundled)
