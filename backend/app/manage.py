"""Explicit administrative role assignment: python -m app.manage grant-dev USERNAME."""
import argparse
import asyncio
from sqlalchemy import select
from .database import SessionLocal, engine
from .models import User


async def grant(username: str) -> None:
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit("Account not found. Create it through normal registration first.")
        user.role = "dev"
        await session.commit()
        print(f"Dev role assigned to {user.username} ({user.id}).")
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["grant-dev"])
    parser.add_argument("username")
    args = parser.parse_args()
    asyncio.run(grant(args.username))
