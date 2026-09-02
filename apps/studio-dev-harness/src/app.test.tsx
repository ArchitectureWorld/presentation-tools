import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StudioApp } from './app'

describe('Report Studio v0.1.0 shell', () => {
  it('enables outline and draft while deferring layout to v0.2.0', () => {
    render(<StudioApp />)
    expect(screen.getByRole('button', { name: '大纲' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '草案' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '排版' })).toBeDisabled()
    expect(screen.getByText('排版功能将在 v0.2.0 开放')).toBeInTheDocument()
  })
})
