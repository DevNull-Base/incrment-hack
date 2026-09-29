import { describe, expect, it } from "vitest"
import { matchesQuery, normalizeSearch, searchItems } from "../search"

describe("поиск", () => {
  it("не зависит от регистра, «ё» и знаков препинания", () => {
    expect(normalizeSearch("МГТУ им. Н.Э. Баумана")).toBe("мгту им н э баумана")
    expect(normalizeSearch("ООО «Базис»")).toBe("ооо базис")
    expect(normalizeSearch("Королёв")).toBe("королев")
  })

  it("все слова запроса должны встретиться, в любом порядке и в любом поле", () => {
    expect(matchesQuery("баумана мгту", ["МГТУ им. Баумана"])).toBe(true)
    expect(matchesQuery("казань кфу", ["КФУ", "Казанский федеральный университет", "Казань"])).toBe(true)
    expect(matchesQuery("казань мгту", ["МГТУ им. Баумана", "Москва"])).toBe(false)
    expect(matchesQuery("", ["что угодно"])).toBe(true)
  })

  it("слово запроса — начало слова записи, а не любая его часть", () => {
    expect(matchesQuery("каз", ["Казанский федеральный университет"])).toBe(true)
    expect(matchesQuery("каз", ["Северо-Кавказский федеральный университет"])).toBe(false)
    expect(matchesQuery("каз", ["Отказ"])).toBe(false)
  })

  it("находит по ИНН и началу слова", () => {
    const items = [
      { name: "СПбПУ", inn: "7804040077" },
      { name: "ИТМО", inn: "7813045547" },
    ]
    expect(searchItems(items, "78130", (i) => [i.name, i.inn]).map((i) => i.name)).toEqual(["ИТМО"])
  })

  it("совпадение с началом названия выше совпадения в других полях", () => {
    const items = [
      { title: "Анализ данных и визуализация", direction: "Данные" },
      { title: "Базы данных и SQL", direction: "Разработка" },
      { title: "Данные в Low-code", direction: "Аналитика" },
    ]
    expect(searchItems(items, "данн", (i) => [i.title, i.direction]).map((i) => i.title)).toEqual([
      "Данные в Low-code",
      "Анализ данных и визуализация",
      "Базы данных и SQL",
    ])
  })
})
