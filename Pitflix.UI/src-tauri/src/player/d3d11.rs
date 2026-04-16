#![cfg(windows)]

use windows::Win32::{
  Foundation::HWND,
  Graphics::{
    Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0},
    Direct3D11::{
      D3D11CreateDeviceAndSwapChain, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
      D3D11_CREATE_DEVICE_FLAG, D3D11_SDK_VERSION,
    },
    Dxgi::{
      Common::{DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_SAMPLE_DESC},
      IDXGISwapChain, DXGI_SWAP_CHAIN_DESC, DXGI_SWAP_EFFECT_DISCARD, DXGI_USAGE_RENDER_TARGET_OUTPUT,
    },
  },
};

pub struct D3D11Swapchain {
  pub device: ID3D11Device,
  pub ctx: ID3D11DeviceContext,
  pub swapchain: IDXGISwapChain,
  pub rtv: ID3D11RenderTargetView,
}

impl D3D11Swapchain {
  pub fn create(hwnd: usize, width: u32, height: u32) -> Result<Self, String> {
    unsafe {
      let mut swap_desc = DXGI_SWAP_CHAIN_DESC::default();
      swap_desc.BufferDesc.Width = width;
      swap_desc.BufferDesc.Height = height;
      swap_desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
      swap_desc.SampleDesc = DXGI_SAMPLE_DESC {
        Count: 1,
        Quality: 0,
      };
      swap_desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
      swap_desc.BufferCount = 2;
      swap_desc.OutputWindow = HWND(hwnd as *mut _);
      swap_desc.Windowed = true.into();
      swap_desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

      let mut device: Option<ID3D11Device> = None;
      let mut ctx: Option<ID3D11DeviceContext> = None;
      let mut swapchain: Option<IDXGISwapChain> = None;

      let rc = D3D11CreateDeviceAndSwapChain(
        None,
        D3D_DRIVER_TYPE_HARDWARE,
        windows::Win32::Foundation::HMODULE::default(),
        D3D11_CREATE_DEVICE_FLAG(0),
        Some(&[D3D_FEATURE_LEVEL_11_0]),
        D3D11_SDK_VERSION,
        Some(&swap_desc),
        Some(&mut swapchain),
        Some(&mut device),
        None,
        Some(&mut ctx),
      );

      if rc.is_err() {
        return Err(format!("D3D11CreateDeviceAndSwapChain failed: {rc:?}"));
      }

      let device = device.ok_or("D3D11 device missing".to_string())?;
      let ctx = ctx.ok_or("D3D11 context missing".to_string())?;
      let swapchain = swapchain.ok_or("DXGI swapchain missing".to_string())?;

      // Create RTV from backbuffer.
      let backbuffer = swapchain
        .GetBuffer::<windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>(0)
        .map_err(|e| format!("swapchain GetBuffer failed: {e:?}"))?;
      let mut rtv: Option<ID3D11RenderTargetView> = None;
      device
        .CreateRenderTargetView(&backbuffer, None, Some(&mut rtv))
        .map_err(|e| format!("CreateRenderTargetView failed: {e:?}"))?;
      let rtv = rtv.ok_or("RTV missing".to_string())?;

      Ok(Self {
        device,
        ctx,
        swapchain,
        rtv,
      })
    }
  }
}

