import type { StateCreator } from "zustand"
import {
  api,
  ApiError,
  type CreateUniversityDto,
  type ItDirectionDto,
  type UniversityContactDto,
  type UniversityContractDto,
  type UniversityNoteDto,
  type UpdateUniversityDto,
  type VendorDto,
} from "@/shared/api"
import { dataSource } from "@/shared/config"
import type { ITProduct, Program, University } from "@/types"
import { normalizeUniversity } from "./api-data"
import type { StoreState } from "./types"
import {
  directions as mockDirections,
  products as mockProducts,
  programs as mockPrograms,
  universities as mockUniversities,
  vendors as mockVendors,
} from "@/mock/data"

// ========================================
// Каталоги: вузы, программы, продукты, направления, вендоры.
// Режим API: списки грузит api-data.loadAppData, контакты, договоры
// и заметки вуза — по запросу страницы.
// ========================================
export interface CatalogSlice {
  universities: University[]
  programs: Program[]
  products: ITProduct[]
  directions: ItDirectionDto[]
  vendors: VendorDto[]
  universityContacts: Record<string, UniversityContactDto[]>
  universityContracts: Record<string, UniversityContractDto[]>
  /** Заметки по вузу целиком (universityId → список). */
  universityNotes: Record<string, UniversityNoteDto[]>
  addUniversity: (draft: Omit<University, "id" | "createdAt" | "engagementCount">) => Promise<University | null>
  patchUniversity: (id: string, patch: Partial<University>) => Promise<void>
  /** Контакты, договоры и заметки вуза (режим API). */
  loadUniversityExtras: (id: string) => Promise<void>
  /** Новый ИТ-продукт каталога (руководитель, администратор). */
  addProduct: (input: { name: string; vendorId: string; description?: string }) => Promise<
    { ok: true; product: ITProduct } | { ok: false; error: string }
  >
  /** Заметка по вузу — то, что не относится ни к одной заявке. */
  addUniversityNote: (
    universityId: string,
    body: string,
    author: { id: string; name: string },
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}

const isApi = dataSource === "api"

function toUniversityBody(u: Partial<University>): CreateUniversityDto & UpdateUniversityDto {
  return {
    name: u.name ?? "",
    ...(u.shortName ? { shortName: u.shortName } : {}),
    ...(u.inn ? { inn: u.inn } : {}),
    ...(u.region ? { region: u.region } : {}),
    ...(u.city ? { city: u.city } : {}),
    ...(u.website ? { website: u.website } : {}),
  }
}

export const createCatalogSlice: StateCreator<StoreState, [], [], CatalogSlice> = (set, get) => ({
  universities: structuredClone(mockUniversities),
  programs: structuredClone(mockPrograms),
  products: structuredClone(mockProducts),
  directions: structuredClone(mockDirections),
  vendors: structuredClone(mockVendors),
  universityContacts: seedUniversityContacts(),
  universityContracts: seedUniversityContracts(),
  universityNotes: seedUniversityNotes(),

  addUniversity: async (draft) => {
    if (isApi) {
      try {
        const created = normalizeUniversity(await api.universities.create(toUniversityBody(draft)))
        set((state) => ({ universities: [created, ...state.universities] }))
        return created
      } catch {
        return null
      }
    }
    const created: University = {
      ...draft,
      id: `u-${Date.now()}`,
      engagementCount: 0,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ universities: [created, ...state.universities] }))
    return created
  },

  patchUniversity: async (id, patch) => {
    if (isApi) {
      const current = get().universities.find((u) => u.id === id)
      if (!current) return
      const updated = normalizeUniversity(
        await api.universities.update(id, toUniversityBody({ ...current, ...patch })),
      )
      set((state) => ({ universities: state.universities.map((u) => (u.id === id ? updated : u)) }))
      return
    }
    set((state) => ({
      universities: state.universities.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }))
  },

  loadUniversityExtras: async (id) => {
    if (!isApi) return
    const [contacts, contracts, notes] = await Promise.all([
      api.universities.contacts(id).catch(() => null),
      api.universities.contracts(id).catch(() => null),
      api.universityNotes.list(id).catch(() => null),
    ])
    set((state) => ({
      universityContacts: contacts ? { ...state.universityContacts, [id]: contacts } : state.universityContacts,
      universityContracts: contracts ? { ...state.universityContracts, [id]: contracts } : state.universityContracts,
      universityNotes: notes ? { ...state.universityNotes, [id]: notes } : state.universityNotes,
    }))
  },

  addProduct: async ({ name, vendorId, description }) => {
    if (isApi) {
      try {
        const product = await api.products.create({ name, vendorId, ...(description ? { description } : {}) }, { silent: true })
        set((state) => ({ products: [...state.products, product] }))
        return { ok: true, product }
      } catch (error) {
        return { ok: false, error: error instanceof ApiError ? error.message : "Сервер недоступен" }
      }
    }
    const vendor = get().vendors.find((v) => v.id === vendorId)
    const product: ITProduct = {
      id: `pr-${Date.now()}`,
      name,
      vendorId,
      vendorName: vendor?.name ?? "",
      description: description ?? null,
      isActive: true,
    }
    set((state) => ({ products: [...state.products, product] }))
    return { ok: true, product }
  },

  addUniversityNote: async (universityId, body, author) => {
    if (isApi) {
      try {
        const note = await api.universityNotes.create(universityId, { body }, { silent: true })
        set((state) => ({
          universityNotes: {
            ...state.universityNotes,
            [universityId]: [note, ...(state.universityNotes[universityId] ?? [])],
          },
        }))
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof ApiError ? error.message : "Сервер недоступен" }
      }
    }
    const note: UniversityNoteDto = {
      id: `un-${Date.now()}`,
      universityId,
      body,
      isPinned: false,
      author,
      createdAt: new Date().toISOString(),
      editedAt: null,
      canEdit: true,
      canDelete: true,
    }
    set((state) => ({
      universityNotes: {
        ...state.universityNotes,
        [universityId]: [note, ...(state.universityNotes[universityId] ?? [])],
      },
    }))
    return { ok: true }
  },
})

function seedUniversityNotes(): Record<string, UniversityNoteDto[]> {
  return {
    u1: [
      {
        id: "un-1",
        universityId: "u1",
        body: "Сменился проректор по цифровизации — прежние договорённости подтвердить заново",
        isPinned: true,
        author: { id: "e1", name: "Иванов А.П." },
        createdAt: "2025-08-20T10:00:00",
        editedAt: null,
        canEdit: true,
        canDelete: true,
      },
    ],
  }
}

function seedUniversityContacts(): Record<string, UniversityContactDto[]> {
  return {
    u1: [
      {
        id: "uc-1",
        personId: "p-c1",
        fullName: "Кузнецов Андрей Иванович",
        phone: "+7 (495) 123-45-67",
        email: "kuznetsov@msu.ru",
        position: "Зав. кафедрой ИТ",
        role: "Руководитель проекта",
        isPrimary: true,
        createdAt: "2025-04-05",
      },
      {
        id: "uc-2",
        personId: "p-c2",
        fullName: "Смирнова Ольга Дмитриевна",
        phone: "+7 (495) 987-65-43",
        email: "smirnova@msu.ru",
        position: "Доцент",
        role: "Куратор программы",
        isPrimary: false,
        createdAt: "2025-04-05",
      },
    ],
    u2: [
      {
        id: "uc-3",
        personId: "p-c3",
        fullName: "Волков Игорь Сергеевич",
        phone: "+7 (812) 555-01-99",
        email: "volkov@spbstu.ru",
        position: "Проректор по развитию",
        role: "Контактное лицо",
        isPrimary: true,
        createdAt: "2025-05-12",
      },
    ],
  }
}

function seedUniversityContracts(): Record<string, UniversityContractDto[]> {
  return {
    u1: [
      {
        id: "uct-1",
        number: "Д-2025/04-МГУ",
        signedAt: "2025-04-20",
        comment: "Договор о сотрудничестве, учебный год 2025/26",
        licenses: [
          {
            id: "lic-c1",
            productId: "pr1",
            productName: "JetBrains IntelliJ IDEA",
            vendorName: "JetBrains",
            signedAt: "2025-04-20",
            validYears: 1,
            validUntil: "2026-04-20",
            validity: "ACTIVE",
            transferStatus: "NOT_STARTED",
            comment: "Учебная лицензия на поток",
          },
        ],
      },
    ],
    u2: [
      {
        id: "uct-2",
        number: "Д-2025/06-СПбПУ",
        signedAt: "2025-06-10",
        comment: "Соглашение о практике студентов",
        licenses: [],
      },
    ],
  }
}
