'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/auth');
const security = require('../../services/securityProfiles');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/security/profiles', (req,res) => {
  res.json({ ok:true, profiles:security.listProfiles(), assignments:security.assignments() });
});

router.post('/security/profiles', asyncHandler(async (req,res) => {
  const input = z.object({
    name:z.string().trim().min(2).max(48),
    description:z.string().max(500).optional(),
    permissions:z.array(z.string().max(32)).max(32),
  }).parse(req.body);
  res.status(201).json({ok:true,profile:security.createProfile(input,{actor:req.user.username})});
}));

router.patch('/security/profiles/:id', asyncHandler(async (req,res) => {
  const input = z.object({
    name:z.string().trim().min(2).max(48).optional(),
    description:z.string().max(500).optional(),
    permissions:z.array(z.string().max(32)).max(32).optional(),
  }).parse(req.body);
  res.json({ok:true,profile:security.updateProfile(req.params.id,input,{actor:req.user.username})});
}));

router.delete('/security/profiles/:id', asyncHandler(async (req,res) => {
  security.deleteProfile(req.params.id,{actor:req.user.username});
  res.json({ok:true});
}));

router.post('/security/profile-assignments', asyncHandler(async (req,res) => {
  const input=z.object({userId:z.string().min(1),serverId:z.string().min(1),profileId:z.string().min(1)}).parse(req.body);
  res.json({ok:true,...security.assignProfile(input,{actor:req.user.username})});
}));

router.delete('/security/profile-assignments/:userId/:serverId', asyncHandler(async (req,res) => {
  security.unassignProfile(req.params.userId,req.params.serverId,{actor:req.user.username});
  res.json({ok:true});
}));

router.get('/security/posture',(req,res)=>res.json({ok:true,posture:security.posture()}));

router.get('/security/sessions', (req,res) => {
  const userId = String(req.query.userId || req.user.id);
  res.json({ok:true,sessions:security.listSessions(userId)});
});

router.delete('/security/sessions/:sid', asyncHandler(async (req,res) => {
  security.revokeSession(req.params.sid,{actor:req.user.username});
  res.json({ok:true});
}));

router.post('/security/sessions/revoke-others', asyncHandler(async (req,res) => {
  const userId=String(req.body?.userId || req.user.id);
  const exceptSid=userId===req.user.id ? req.sessionID : null;
  const count=security.revokeOtherSessions(userId,exceptSid,{actor:req.user.username});
  res.json({ok:true,count});
}));

module.exports=router;
