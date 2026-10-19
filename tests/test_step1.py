import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from server.db import connect
from server.main import create_app


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".sqlite")
        os.environ["SIM_DB"] = self.tmp.name
        self.client = TestClient(create_app(self.tmp.name))

    def tearDown(self):
        self.tmp.close()

    def test_register_login_and_reject_a_wrong_password(self):
        created = self.client.post("/api/register", json={"username": "Mada", "password": "practice1"})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertIn("token", created.json())

        bad = self.client.post("/api/login", json={"username": "Mada", "password": "wrong-pass"})
        self.assertEqual(bad.status_code, 401)
        self.assertIn("not valid", bad.json()["detail"])

        good = self.client.post("/api/login", json={"username": "mada", "password": "practice1"})
        self.assertEqual(good.status_code, 200)

        with connect(self.tmp.name) as conn:
            row = conn.execute("SELECT password_hash FROM accounts").fetchone()
        self.assertNotIn("practice1", row["password_hash"])

    def test_age_group_selects_the_task_cards(self):
        token = self.client.post(
            "/api/register", json={"username": "Kholoud", "password": "practice1"}
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        saved = self.client.put(
            "/api/profile",
            headers=headers,
            json={
                "gender": "female",
                "age_group": "under_18",
                "avatar": {"skin": "medium", "hair": "tied", "outfit": "navy"},
                "mode": "normal",
            },
        )
        self.assertTrue(saved.json()["complete"])
        school = self.client.get("/api/levels", headers=headers).json()["levels"]
        self.assertEqual([item["task"] for item in school], [
            "A short class talk",
            "Explain a school project",
            "Present to the class",
        ])

        self.client.put("/api/profile", headers=headers, json={"age_group": "18_plus"})
        adult = self.client.get("/api/levels", headers=headers).json()["levels"]
        self.assertEqual(adult[2]["task"], "Job interview")
        self.assertEqual(adult[0]["room"], "Small calm group")


if __name__ == "__main__":
    unittest.main()
