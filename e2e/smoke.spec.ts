import { test, expect } from '@playwright/test'

// смоук полного раунда на локальном транспорте (одна вкладка, дев-панель
// перспектив): проверяет связку UI ↔ useRoom ↔ движок, недоступную selfcheck'ам
test('полный раунд versus: подсказка → стрелка → сторона → раскрытие', async ({ page }) => {
  await page.goto('/')

  // вход: Аня попадает в левую команду (автобаланс при равенстве)
  await page.getByPlaceholder('Твоё имя').fill('Аня')
  await page.getByRole('button', { name: 'Войти' }).click()

  // второй игрок в правую через дев-панель
  await page.getByRole('button', { name: '+ в Правое' }).click()

  await page.getByRole('button', { name: 'Начать игру' }).click()

  // телепат — Аня (единственная в левой): секрет и commit создаются на её устройстве
  await page.getByPlaceholder('Подсказка').fill('Кофе')
  await page.getByRole('button', { name: 'Дать подсказку' }).click()

  // команда телепата фиксирует стрелку
  await page.getByRole('button', { name: 'Стрелка установлена' }).click()

  // перспектива второго игрока: выбор стороны
  await page.getByRole('button', { name: 'Игрок 2' }).click()
  await page.getByRole('button', { name: 'Левее' }).click()

  // обратно к телепату: раскрытие мишени
  await page.getByRole('button', { name: 'Аня' }).click()
  await page.getByRole('button', { name: 'Открыть экран' }).click()

  // раунд оценён: показан следующий шаг
  await expect(page.getByRole('button', { name: 'Следующий раунд' })).toBeVisible()
})
