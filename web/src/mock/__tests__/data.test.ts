import { describe, it, expect } from "vitest"
import {
  universities,
  directions,
  programs,
  interactions,
  employees,
  documents,
  streams,
  applications,
  meetings,
  activityEvents,
  notifications,
  auditLog,
  currentUser,
  products,
} from "@/mock/data"

describe("Mock Data Integrity", () => {
  describe("Universities", () => {
    it("should have at least 1 university", () => {
      expect(universities.length).toBeGreaterThan(0)
    })

    it("each university should have required fields", () => {
      universities.forEach((uni) => {
        expect(uni).toHaveProperty("id")
        expect(uni).toHaveProperty("name")
        expect(uni).toHaveProperty("shortName")
        expect(uni).toHaveProperty("region")
        expect(uni).toHaveProperty("isActive")
        expect(typeof uni.isActive).toBe("boolean")
        expect(uni).toHaveProperty("engagementCount")
        expect(uni.engagementCount).toBeGreaterThanOrEqual(0)
      })
    })

    it("university IDs should be unique", () => {
      const ids = universities.map((u) => u.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it("should match known engagement counts and active flags", () => {
      const byId = new Map(universities.map((u) => [u.id, u]))
      expect(byId.get("u1")?.engagementCount).toBe(4)
      expect(byId.get("u2")?.engagementCount).toBe(3)
      expect(byId.get("u3")?.engagementCount).toBe(2)
      expect(byId.get("u4")?.engagementCount).toBe(1)
      expect(byId.get("u5")?.engagementCount).toBe(2)
      expect(byId.get("u4")?.isActive).toBe(false)
      expect(byId.get("u1")?.isActive).toBe(true)
      expect(byId.get("u2")?.isActive).toBe(true)
      expect(byId.get("u3")?.isActive).toBe(true)
      expect(byId.get("u5")?.isActive).toBe(true)
    })
  })

  describe("Directions", () => {
    it("should have 7 directions", () => {
      expect(directions.length).toBe(7)
      directions.forEach((dir) => {
        expect(dir).toHaveProperty("id")
        expect(dir).toHaveProperty("name")
        expect(dir).toHaveProperty("code")
        expect(dir.isActive).toBe(true)
      })
    })
  })

  describe("Programs", () => {
    it("should have at least 1 program", () => {
      expect(programs.length).toBeGreaterThan(0)
    })

    it("each program should have API fields", () => {
      programs.forEach((prog) => {
        expect(prog).toHaveProperty("id")
        expect(prog).toHaveProperty("name")
        expect(prog).toHaveProperty("directionId")
        expect(prog).toHaveProperty("directionName")
        expect(prog.isActive).toBe(true)
        expect(typeof prog.hoursTotal).toBe("number")
        expect(prog.hoursTotal).toBeGreaterThan(0)
      })
    })

    it("should have 16 programs with catalog fields", () => {
      expect(programs.length).toBe(16)
      // Известные значения первых пяти программ сохранены.
      const byId = new Map(programs.map((p) => [p.id, p]))
      expect(byId.get("p1")?.hoursTotal).toBe(720)
      expect(byId.get("p2")?.hoursTotal).toBe(680)
      expect(byId.get("p3")?.hoursTotal).toBe(640)
      expect(byId.get("p4")?.hoursTotal).toBe(360)
      expect(byId.get("p5")?.hoursTotal).toBe(800)
      // Новые поля каталога курсов обязательны у всех.
      programs.forEach((p) => {
        expect(["rtk-school", "edu-rt", "sz-rt", "edupro"]).toContain(p.source)
        expect(p.description).toBeTruthy()
        expect(p.audience).toBeTruthy()
        expect(p.requirements).toBeTruthy()
        expect(p.hoursTotal).toBeGreaterThan(0)
      })
      expect(programs.every((p) => p.isActive)).toBe(true)
    })

    it("each program should reference valid direction", () => {
      const dirIds = new Set(directions.map((d) => d.id))
      programs.forEach((prog) => {
        expect(dirIds).toContain(prog.directionId)
      })
    })
  })

  describe("Products and vendors", () => {
    it("products should have API fields", () => {
      expect(products.length).toBe(4)
      products.forEach((prod) => {
        expect(prod).toHaveProperty("id")
        expect(prod).toHaveProperty("name")
        expect(prod).toHaveProperty("vendorId")
        expect(prod).toHaveProperty("vendorName")
        expect(prod.isActive).toBe(true)
      })
    })
  })

  describe("Interactions", () => {
    it("should have at least 1 interaction", () => {
      expect(interactions.length).toBeGreaterThan(0)
    })

    it("each interaction should reference valid university", () => {
      const uniIds = new Set(universities.map((u) => u.id))
      interactions.forEach((inter) => {
        // B2C-заявки могут существовать без вуза (universityId = null)
        if (inter.universityId == null) return
        expect(uniIds).toContain(inter.universityId)
      })
    })

    it("each interaction should reference valid direction", () => {
      const dirIds = new Set(directions.map((d) => d.id))
      interactions.forEach((inter) => {
        expect(dirIds).toContain(inter.directionId)
      })
    })

    it("each interaction product name should match products when present", () => {
      const prodNames = new Set(products.map((p) => p.name))
      interactions.forEach((inter) => {
        if (inter.productName) {
          expect(prodNames).toContain(inter.productName)
        }
      })
    })

    it("each interaction should reference valid employee", () => {
      const empIds = new Set(employees.map((e) => e.id))
      interactions.forEach((inter) => {
        expect(empIds).toContain(inter.ownerId)
      })
    })

    it("each interaction should have currentStateKey and label", () => {
      interactions.forEach((inter) => {
        expect(inter.currentStateKey).toBeTruthy()
        expect(inter.currentStateLabel).toBeTruthy()
        expect(inter).toHaveProperty("isOverdue")
      })
    })

    it("should match known interaction state keys", () => {
      const byId = new Map(interactions.map((i) => [i.id, i]))
      expect(byId.get("i1")?.currentStateKey).toBe("TEACHER_TRAINING")
      expect(byId.get("i2")?.currentStateKey).toBe("SIGNING")
      expect(byId.get("i2")?.isOverdue).toBe(true)
      expect(byId.get("i3")?.currentStateKey).toBe("IMPLEMENTATION_SUPPORT")
      expect(byId.get("i4")?.currentStateKey).toBe("MEETING")
      expect(byId.get("i5")?.currentStateKey).toBe("SEARCH_CONTACTS")
      expect(byId.get("i1")?.universityId).toBe("u1")
      expect(byId.get("i2")?.universityId).toBe("u2")
      expect(byId.get("i3")?.universityId).toBe("u3")
      expect(byId.get("i4")?.universityId).toBe("u5")
      expect(byId.get("i5")?.universityId).toBe("u4")
      expect(byId.get("i1")?.ownerId).toBe("e1")
      expect(byId.get("i2")?.ownerId).toBe("e2")
      expect(byId.get("i3")?.ownerId).toBe("e1")
      expect(byId.get("i4")?.ownerId).toBe("e2")
      expect(byId.get("i5")?.ownerId).toBe("e1")
      expect(byId.get("i1")?.directionId).toBe("dir1")
      expect(byId.get("i2")?.directionId).toBe("dir2")
      expect(byId.get("i3")?.directionId).toBe("dir3")
      expect(byId.get("i4")?.directionId).toBe("dir1")
      expect(byId.get("i5")?.directionId).toBe("dir4")
      expect(byId.get("i1")?.directionName).toBe("Разработка ПО")
      expect(byId.get("i2")?.directionName).toBe("Информационная безопасность")
      expect(byId.get("i3")?.directionName).toBe("Данные и аналитика")
      expect(byId.get("i4")?.directionName).toBe("Разработка ПО")
      expect(byId.get("i5")?.directionName).toBe("Основы программирования")
    })
  })

  describe("Documents", () => {
    it("each document should reference valid interaction", () => {
      const interIds = new Set(interactions.map((i) => i.id))
      documents.forEach((doc) => {
        expect(interIds).toContain(doc.interactionId)
      })
    })

    it("each document should have valid status", () => {
      documents.forEach((doc) => {
        expect(["draft", "review", "signed", "rejected"]).toContain(doc.status)
      })
    })
  })

  describe("Employees", () => {
    it("should have at least 1 employee", () => {
      expect(employees.length).toBeGreaterThan(0)
    })

    it("each employee should have valid role", () => {
      employees.forEach((emp) => {
        expect(["USER", "MANAGER", "ADMIN"]).toContain(emp.role)
        expect(emp).toHaveProperty("displayName")
        expect(emp).toHaveProperty("email")
        expect(emp).toHaveProperty("dataScope")
      })
    })

    it("should have expected roles for known employees", () => {
      const byId = new Map(employees.map((e) => [e.id, e]))
      expect(byId.get("e1")?.role).toBe("MANAGER")
      expect(byId.get("e2")?.role).toBe("MANAGER")
      expect(byId.get("e3")?.role).toBe("USER")
      expect(byId.get("e4")?.role).toBe("USER")
      expect(byId.get("e5")?.role).toBe("ADMIN")
    })
  })

  describe("Notifications", () => {
    it("should have unread and read notifications", () => {
      expect(notifications.length).toBe(3)
      const byId = new Map(notifications.map((n) => [n.id, n]))
      expect(byId.get("n1")?.readAt).toBeNull()
      expect(byId.get("n2")?.readAt).toBeNull()
      expect(byId.get("n3")?.readAt).not.toBeNull()
      expect(byId.get("n1")?.entityType).toBe("engagement")
      expect(byId.get("n2")?.entityType).toBe("engagement")
      expect(byId.get("n3")?.entityType).toBe("engagement")
      expect(byId.get("n1")?.entityId).toBe("i2")
      expect(byId.get("n2")?.entityId).toBe("i4")
      expect(byId.get("n3")?.entityId).toBe("i3")
    })
  })

  describe("Audit log", () => {
    it("should have API audit fields", () => {
      expect(auditLog.length).toBe(10)
      const knownEmails = new Set([
        "ivanov@rtk.ru",
        "petrova@rtk.ru",
        "sidorov@rtk.ru",
        "admin@rtk.ru",
      ])
      auditLog.forEach((entry) => {
        expect(entry).toHaveProperty("occurredAt")
        expect(entry.occurredAt.endsWith("Z")).toBe(true)
        expect(entry).toHaveProperty("action")
        if (entry.actorEmail !== null) {
          expect(knownEmails).toContain(entry.actorEmail)
        }
      })
    })
  })

  describe("CurrentUser", () => {
    it("should have valid profile structure", () => {
      expect(currentUser).toHaveProperty("id")
      expect(currentUser).toHaveProperty("displayName")
      expect(currentUser).toHaveProperty("role")
      expect(currentUser).toHaveProperty("email")
      expect(currentUser).toHaveProperty("dataScope")
      expect(currentUser.id).toBe("e1")
      expect(currentUser.email).toBe("ivanov@rtk.ru")
      expect(currentUser.displayName).toBe("Иванов Алексей Петрович")
      expect(currentUser.role).toBe("MANAGER")
      expect(currentUser.managerId).toBe("e3")
      expect(currentUser.dataScope).toEqual({
        restricted: false,
        ownerCount: null,
        universityCount: null,
      })
    })
  })

  describe("Referential integrity", () => {
    it("all streams should reference valid programs", () => {
      const progIds = new Set(programs.map((p) => p.id))
      streams.forEach((s) => {
        expect(progIds).toContain(s.programId)
      })
    })

    it("all applications should reference valid programs", () => {
      const progIds = new Set(programs.map((p) => p.id))
      applications.forEach((a) => {
        expect(progIds).toContain(a.programId)
      })
    })

    it("all meetings should reference valid interactions", () => {
      const interIds = new Set(interactions.map((i) => i.id))
      meetings.forEach((m) => {
        expect(interIds).toContain(m.interactionId)
      })
    })

    it("all activity events should reference valid entities", () => {
      const interIds = new Set(interactions.map((i) => i.id))
      const docIds = new Set(documents.map((d) => d.id))
      activityEvents.forEach((e) => {
        if (e.entityType === "engagement") expect(interIds).toContain(e.entityId)
        if (e.entityType === "document") expect(docIds).toContain(e.entityId)
      })
    })
  })
})
