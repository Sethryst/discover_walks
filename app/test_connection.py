from sqlalchemy import text

from app.core.config import Settings
from app.core.database import build_engine

engine = build_engine(Settings.from_environment())

try:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT version();"))
        print("✅ GREMLIN HANDSHAKE SUCCESS")
        print(result.fetchone()[0])

except Exception as exc:
    print("❌ Handshake failed")
    print(exc)
