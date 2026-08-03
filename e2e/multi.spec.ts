import { test, expect, type Page } from '@playwright/test'

// многоклиентные сценарии: две вкладки в одной комнате общаются через
// BroadcastChannel-транспорт. проверяется то, что недоступно однвкладочному
// смоуку — синхронизация стола, роли на разных устройствах, кик, восстановление
// после перезагрузки. код комнаты у каждого теста свой: вкладки соседних тестов
// иначе слышат друг друга через общий канал

const room = (name: string): string => `/?room=${name}#k=secret-${name}`

const join = async (page: Page, url: string, name: string): Promise<void> => {
  await page.goto(url)
  await page.getByPlaceholder('Твоё имя').fill(name)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByText(`Ты: ${name}`)).toBeVisible()
}

test('две вкладки: полный раунд versus с ролями на разных устройствах', async ({ browser }) => {
  const context = await browser.newContext()
  const url = room('E2EDUO')
  const anya = await context.newPage()
  const boris = await context.newPage()

  await join(anya, url, 'Аня')
  await join(boris, url, 'Боря')

  // автобаланс развёл по командам, и обе вкладки видят обоих игроков
  await expect(anya.getByText('Боря')).toBeVisible()
  await expect(boris.getByText('Аня')).toBeVisible()

  await anya.getByRole('button', { name: 'Начать игру' }).click()

  // Аня вошла первой → левая команда ходит первой, телепат из неё
  await expect(anya.getByPlaceholder('Подсказка')).toBeVisible()
  await expect(boris.getByText('придумывает подсказку')).toBeVisible()

  await anya.getByPlaceholder('Подсказка').fill('Кофе')
  await anya.getByRole('button', { name: 'Дать подсказку' }).click()

  // подсказка долетела до второй вкладки
  await expect(boris.getByText('«Кофе»')).toBeVisible()

  await anya.getByRole('button', { name: 'Стрелка установлена' }).click()
  await boris.getByRole('button', { name: 'Левее' }).click()

  await anya.getByRole('button', { name: 'Открыть экран' }).click()

  // раунд оценён у обоих, история заполнилась
  await expect(anya.getByRole('button', { name: 'Следующий раунд' })).toBeVisible()
  await expect(boris.getByRole('button', { name: 'Следующий раунд' })).toBeVisible()
  await boris.getByRole('button', { name: 'Итоги раундов' }).click()
  await expect(boris.getByRole('cell', { name: '«Кофе»' })).toBeVisible()

  await context.close()
})

test('перезагрузка вкладки возвращает игрока на его место', async ({ browser }) => {
  const context = await browser.newContext()
  const url = room('E2ERELOAD')
  const host = await context.newPage()
  const guest = await context.newPage()

  await join(host, url, 'Хост')
  await join(guest, url, 'Гость')
  await expect(host.getByText('Гость')).toBeVisible()

  await guest.reload()

  // место сохранилось: форма входа не показывается, имя на месте
  await expect(guest.getByText('Ты: Гость')).toBeVisible()
  await expect(guest.getByPlaceholder('Твоё имя')).toHaveCount(0)
  await expect(host.getByText('Гость')).toBeVisible()

  await context.close()
})

test('кик требует подтверждения и выгоняет игрока у всех', async ({ browser }) => {
  const context = await browser.newContext()
  const url = room('E2EKICK')
  const host = await context.newPage()
  const guest = await context.newPage()

  await join(host, url, 'Хозяин')
  await join(guest, url, 'Лишний')
  await expect(host.getByText('Лишний')).toBeVisible()

  // первый клик только взводит кнопку, игрок остаётся
  await host.getByRole('button', { name: 'Выгнать Лишний' }).click()
  await expect(host.getByText('Лишний')).toBeVisible()
  await host.getByRole('button', { name: 'Точно?: Выгнать Лишний' }).click()

  await expect(host.getByText('Лишний')).toHaveCount(0)
  // кикнутая вкладка не возвращается сама и видит форму входа
  await expect(guest.getByPlaceholder('Твоё имя')).toBeVisible()

  await context.close()
})

test('свои карточки сохраняются и попадают в игру', async ({ page }) => {
  await page.goto(room('E2EDECK'))
  await page.getByRole('button', { name: 'Свои карточки' }).click()
  await page.getByRole('textbox', { name: 'Свои карточки' }).fill('Ямб | Хорей')
  await expect(page.getByText('распознано пар: 1')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await page.reload()
  await page.getByRole('button', { name: 'Свои карточки' }).click()
  await expect(page.getByRole('textbox', { name: 'Свои карточки' })).toHaveValue('Ямб | Хорей')
})
